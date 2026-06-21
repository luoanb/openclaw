# OpenClaw 循环调度策略（Cron Scheduling Strategy）

> 范围：从定时任务触发到 Agent 执行的完整调度链路。
> 涵盖所有调度类型、循环驱动模型、防冲突机制。

---

## 目录

1. [调度总览](#1-调度总览)
2. [Phase 1 — 主调度循环](#2-phase-1--主调度循环cron-service-timer-loop)
3. [Phase 2 — 调度计算](#3-phase-2--调度计算schedule-computation)
4. [Phase 3 — 任务执行](#4-phase-3--任务执行job-execution)
5. [Phase 4 — 心跳调度](#5-phase-4--心跳调度heartbeat-scheduling)
6. [Phase 5 — 系统事件队列](#6-phase-5--系统事件队列system-events-queue)
7. [Phase 6 — 会话回收](#7-phase-6--会话回收session-reaper)
8. [Phase 7 — 启动恢复](#8-phase-7--启动恢复startup-catchup)
9. [Phase 8 — 失败处理与告警](#9-phase-8--失败处理与告警failure-handling)
10. [防冲突机制](#10-防冲突机制anti-conflict-mechanisms)
11. [文件索引与导入关系](#11-文件索引与导入关系)

---

## 各阶段摘要

### Phase 1 — 主调度循环

|          |                                                               |
| -------- | ------------------------------------------------------------- |
| **输入** | 持久化的 CronJob 列表（含 schedule、state）                   |
| **输出** | 到期的 Job 被逐一取出、标记 running、执行、更新状态、重新入队 |

### Phase 2 — 调度计算

|          |                                                         |
| -------- | ------------------------------------------------------- |
| **输入** | CronSchedule（at/every/cron）+ 当前时间                 |
| **输出** | 下次执行时间戳（nextRunAtMs），或 undefined（不再执行） |

### Phase 3 — 任务执行

|          |                                                                |
| -------- | -------------------------------------------------------------- |
| **输入** | 到期 Job + 执行上下文（main/isolated + payload）               |
| **输出** | 执行结果（ok/error/skipped）+ delivery 结果 + 持久化的 Run Log |

### Phase 4 — 心跳调度

|          |                                            |
| -------- | ------------------------------------------ |
| **输入** | 心跳间隔、Agent ID、Scheduler Seed         |
| **输出** | Agent 在相位对齐的时间点被唤醒执行心跳回合 |

### Phase 5 — 系统事件队列

|          |                                                 |
| -------- | ----------------------------------------------- |
| **输入** | 来自 Cron/心跳/节点/会话的系统事件文本          |
| **输出** | 下次 Agent 回合开始时压入提示词前缀的系统事件块 |

### Phase 6 — 会话回收

|          |                                             |
| -------- | ------------------------------------------- |
| **输入** | 超时的 Isolated Cron 会话记录               |
| **输出** | 已删除的过期会话 + 已清理的 Transcript 文件 |

### Phase 7 — 启动恢复

|          |                                                                    |
| -------- | ------------------------------------------------------------------ |
| **输入** | Gateway 重启前未执行的 Missed Job 列表 + 未完成的 Running Job 标记 |
| **输出** | 中断任务标记失败 + 遗漏任务选择性执行                              |

### Phase 8 — 失败处理与告警

|          |                                                         |
| -------- | ------------------------------------------------------- |
| **输入** | 执行失败的 Job（error/skipped）                         |
| **输出** | 退避重试 + 连续失败告警（通知/Webhook）+ 可选的自动禁用 |

### 防冲突机制

|          |                                                |
| -------- | ---------------------------------------------- |
| **输入** | 多个定时器 / 多个 Job / 同 Session 并发        |
| **输出** | 去重、锁定、相位偏移、最小间隔等保证调度正确性 |

---

## 1. 调度总览

```
用户创建 CronJob
    │  ┌───────────────────────────────────────────────────────────────┐
    ▼  │                     Cron Store (JSON)                         │
[Gateway Startup]      jobs: [{id, schedule, payload, state...}]        │
    │                  timer: setTimeout → onTimer                     │
    ▼                  running: boolean (tick guard)                   │
┌──────────────────┐  └───────────────────────────────────────────────┘
│  armTimer()      │
│  找出最近的到期  │
│  Job → setTimeout│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  onTimer()       │  ← 每次 setTimeout 到期
│  ├─ 锁住 state   │
│  ├─ findDueJobs  │
│  ├─ 标记 running │
│  ├─ 逐个执行     │
│  └─ recompute +  │
│     armTimer()   │
└──────────────────┘
         │
         ├─ SystemEvent Job → enqueueSystemEventEntry()
         ├─ AgentTurn Job  → sessions_send / spawn isolated
         └─ Command Job    → exec / command runner
```

### 调度类型

| 类型            | 示例                                         | 适用场景                           |
| --------------- | -------------------------------------------- | ---------------------------------- |
| `kind: "at"`    | `{ at: "2026-06-20T10:00:00+08:00" }`        | 一次性定时任务，执行后自动禁用     |
| `kind: "every"` | `{ everyMs: 3600000, anchorMs: ... }`        | 固定间隔循环任务，支持锚点对齐     |
| `kind: "cron"`  | `{ expr: "0 9 * * *", tz: "Asia/Shanghai" }` | Cron 表达式，支持自定义时区 + 偏移 |

### 执行目标

| 目标           | 路由     | 说明                                 |
| -------------- | -------- | ------------------------------------ |
| `main`         | 主会话   | 向 Agent 主会话注入 SystemEvent 文本 |
| `isolated`     | 独立会话 | 启动独立的 Agent 会话执行 AgentTurn  |
| `current`      | 当前会话 | 绑定额外的消息到当前会话             |
| `session:<id>` | 指定会话 | 路由到命名会话                       |

### 三种 Payload

| Payload                          | 处理方式                   | 输出           |
| -------------------------------- | -------------------------- | -------------- |
| `{ kind: "systemEvent", text }`  | → enqueueSystemEventEntry  | 系统事件文本   |
| `{ kind: "agentTurn", message }` | → 创建 Isolated Agent 会话 | Agent 回复文本 |
| `{ kind: "command", argv }`      | → 子进程执行               | 命令输出       |

---

## 2. Phase 1 — 主调度循环（Cron Service Timer Loop）

**文件：** `cron/service/timer.ts`

### 循环模型

```
Gateway 启动
    │
    ▼
CronService.start()
    │
    ▼
ops.start()
    ├─ load store (JSON → memory)
    ├─ markInterruptedStartupRun()  ← 标记崩溃时 running=true 的 job
    ├─ runMissedJobs()              ← 执行启动时过期的 job
    ├─ recomputeNextRuns()          ← 重新计算所有 nextRunAtMs
    └─ armTimer()                   ← 设定第一个 setTimeout
         │
         ▼  (定时器到期)
    onTimer()
         │
         ├─ locked(state)  ← 互斥锁，防止并发 tick
         ├─ ensureLoaded() ← 重新加载 store
         ├─ collectRunnableJobs()
         │     ├─ enabled === true
         │     ├─ nextRunAtMs <= now
         │     ├─ runningAtMs === undefined（未被其他 tick 占用）
         │     └─ runningAtMs from persistence → 清理崩溃残留
         │
         ├─ 标记 due jobs.runningAtMs = now
         ├─ persist()
         │
         ├─ 逐个 executeJob()
         │     ├─ resolveDeliveryPlan()
         │     ├─ createActiveJobMarker()  ← 防止同 job 并发
         │     ├─ executeJobCore()         ← 实际执行
         │     │     ├─ systemEvent → enqueue
         │     │     ├─ agentTurn  → spawn isolated
         │     │     └─ command    → exec
         │     └─ applyJobResult()         ← 更新 state + 持久化
         │
         ├─ recomputeNextRuns() ← 计算下次执行时间
         ├─ sweepCronRunSessions() ← 清理过期会话
         └─ armTimer() ← 设定下一个 setTimeout
```

### 关键机制

| 机制                | 说明                                           |
| ------------------- | ---------------------------------------------- |
| **setTimeout 驱动** | 每次 arming 只设一个定时器，指向最近的到期时间 |
| **互斥锁 locked()** | 同一时刻只有一个 onTimer 在执行                |
| **Watchdog 定时器** | 即使 onTimer 卡死，60s 后 Watchdog 会重新触达  |
| **最小间隔 2s**     | 防止 delay=0 导致的 setTimeout 热循环          |
| **最长间隔 60s**    | 防止长时间不检查导致的调度漂移                 |

### 定时器参数的约束

```
flooredDelay = max(delay, MIN_REFIRE_GAP_MS)   // 最小 2s
clampedDelay = min(flooredDelay, MAX_TIMER_DELAY_MS)  // 最大 60s
```

### onTimer 并发防护

```typescript
if (state.running) {
  armRunningRecheckTimer(state);
  return; // 当前 tick 未完成，不执行，但 60s 后重试
}
state.running = true;
```

---

## 3. Phase 2 — 调度计算（Schedule Computation）

**文件：** `cron/schedule.ts`

### at 类型

```typescript
schedule.kind === "at"
  → parseAbsoluteTimeMs(schedule.at)
  → atMs > nowMs ? atMs : undefined  // 已过期返回 undefined
```

### every 类型

```typescript
anchor = schedule.anchorMs ?? nowMs;
elapsed = nowMs - anchor;
steps = floor(elapsed / everyMs) + 1;
nextRunAtMs = anchor + steps * everyMs;
```

### cron 类型

```typescript
croner = resolveCachedCron(expr, timezone); // LRU 缓存，最大 512 项
nextRun = croner.nextRun(new Date(nowMs));
```

#### Croner 缓存

```typescript
key = `${timezone}\0${expr}`
cache size ≤ 512
LRU eviction on overflow
```

**Workaround**：Croner 在某些时区/日期组合下返回过去的时间戳。当 `nextMs <= nowMs` 时，会从下一秒、次日凌晨分别重试。

### Stagger（防集中触发）

**文件：** `cron/stagger.ts`

| 策略               | 说明                                             |
| ------------------ | ------------------------------------------------ |
| 整点 Cron 默认偏移 | `minute=0, hour=*/wildcard` → 自动加 5min jitter |
| 显式 stagger 优先  | `schedule.staggerMs` 指定精确偏移值              |
| 偏移窗口           | 0 ~ staggerMs 之间的随机 ms                      |

```typescript
// 判断是否整点
isRecurringTopOfHourCronExpr("0 * * * *")     → true
isRecurringTopOfHourCronExpr("*/30 * * * *")   → false

// 默认整点偏移
resolveDefaultCronStaggerMs("0 * * * *")  → 300_000 (5min)
```

---

## 4. Phase 3 — 任务执行（Job Execution）

**文件：** `cron/service/timer.ts`（executeJobCore）

### 执行流程

```
executeJobCore(state, job, dueAt)
│
├─ 解析 Job Payload
│   ├─ kind: "systemEvent"
│   │   → resolveJobPayloadTextForMain()
│   │   → enqueueSystemEventEntry(sessionKey, text)
│   │
│   ├─ kind: "agentTurn"
│   │   → createIsolatedAgentSession()
│   │   → 发送 AgentTurn 消息
│   │   → 等待执行完成
│   │   → 处理回复
│   │
│   └─ kind: "command"
│       → exec subprocess
│       → 收集 stdout/stderr
│
├─ 创建 ActiveJobMarker（进程级去重）
├─ 执行 + 超时保护
│   ├─ agentWatchdog → agent_setup_timeout (30s)
│   └─ modelTimeout → resolveCronJobTimeoutMs()
│
├─ Delivery（结果投递）
│   ├─ deliveryPlan = resolveCronDeliveryPlan(job)
│   ├─ mode: "none" | "announce" | "webhook"
│   └─ deliveryTrace + 结果持久化
│
└─ 写 RunLog → cron/run-log/
```

### Run 结果状态

| Status    | 含义                                   |
| --------- | -------------------------------------- |
| `ok`      | 执行成功                               |
| `error`   | 执行失败（+ error text + diagnostics） |
| `skipped` | 被跳过（例如同 job 正在运行）          |

### Delivery 结果

| Status          | 含义       |
| --------------- | ---------- |
| `delivered`     | 成功投递   |
| `not-delivered` | 投递失败   |
| `unknown`       | 状态未知   |
| `not-requested` | 未请求投递 |

### 执行后的状态更新

```
applyJobResult(state, result)
│
├─ 更新 job.state
│   ├─ lastRunAtMs, lastRunStatus, lastDurationMs
│   ├─ lastError / consecutiveErrors
│   ├─ lastDeliveryStatus
│   └─ ...
│
├─ 计算下一次 nextRunAtMs
│   ├─ at 类型 → disabled（一次性，执行后禁用）
│   ├─ every 类型 → now + everyMs
│   ├─ cron 类型 → croner.nextRun()
│   └─ 连续失败 → errorBackoffMs() 退避
│
├─ 退避策略
│   ├─ consecutiveErrors × DEFAULT_ERROR_BACKOFF_SCHEDULE_MS
│   ├─ 每多一次失败，下次执行延迟更长
│   └─ 成功时重置 consecutiveErrors
│
├─ deleteAfterRun → 删除 job
└─ persist()
```

---

## 5. Phase 4 — 心跳调度（Heartbeat Scheduling）

**文件：** `infra/heartbeat-schedule.ts`, `infra/heartbeat-runner.ts`

### 相位对齐（Phase Alignment）

心跳不是简单按间隔触发，而是通过 Agent ID 的哈希值将每个 Agent 分散到时间轴上：

```
phaseMs = SHA256(schedulerSeed:agentId) % intervalMs
```

**作用**：即使 100 个 Agent 配置相同的心跳间隔，它们的唤醒时刻也会均匀分散在整段时间轴上，不会同时触发。

### 下次触发时间

```
cyclePositionMs = nowMs % intervalMs
deltaMs = (phaseMs - cyclePositionMs + intervalMs) % intervalMs
nextDueMs = nowMs + deltaMs
```

如果 deltaMs === 0（正好在相位点上），则推后一个间隔：

```
if (deltaMs === 0) deltaMs = intervalMs
```

### 活跃时段门控

```
seekNextActivePhaseDueMs(startMs, intervalMs, phaseMs, isActive?)
  → 在 startMs ~ startMs + 7天的范围内
    寻找第一个落在活跃时段内的相位点
  → 最多迭代 10080 次（7天/1分钟步长）
  → 找不到时返回原始相位点，由运行时 Guard 拦截
```

### 心跳 Runner 链路

```
heartbeat-runner.ts
│
├─ listAgentIds() → 遍历所有 Agent
├─ resolveAgentConfig() → 读取心跳配置（interval, activeHours, channels）
├─ resolveHeartbeatPhaseMs() → 计算该 Agent 的相位
├─ resolveNextHeartbeatDueMs() → 计算下次到期时间
│
├─ 到期时：
│   ├─ 检查 agent 是否 active（活跃时段内）
│   ├─ 读取 HEARTBEAT.md
│   ├─ 构建心跳提示词
│   ├─ 发送给 Agent 执行
│   └─ 处理回复（strip token, check empty）
│
├─ 广播 HeartbeatEvent → UI 订阅
└─ emitHeartbeatEvent()
```

### 心跳执行结果

| 状态       | 含义                              |
| ---------- | --------------------------------- |
| `sent`     | 正常发送，有输出内容              |
| `ok-empty` | 执行成功但回复为空                |
| `ok-token` | 执行成功，仅包含心跳 Token        |
| `skipped`  | 被跳过（Agent 繁忙/不在活跃时段） |
| `failed`   | 执行失败                          |

---

## 6. Phase 5 — 系统事件队列（System Events Queue）

**文件：** `infra/system-events.ts`

### 队列模型

```
入队入口
enqueueSystemEventEntry(text, { sessionKey, contextKey? })
│
├─ 去重检查（findDuplicateInQueue）
│   ├─ contextKey === null → 只与队尾比较
│   └─ contextKey !== null → 遍历全队
│
├─ 安全过滤（sanitizeInboundSystemTags）
│
├─ 入队（FIFO）
│   └─ 队满（max 20）→ 丢弃最旧
│
└─ 返回 cloneEvent / null
```

### 出队时机

```
回合边界 → drainSystemEventEntries(sessionKey)
    └─ 返回所有排队事件，清空队列
    └─ 格式化后注入下一轮提示词前缀
```

### 去重规则

```typescript
contextKey === null → 只与队尾最后一条比较
contextKey !== null → 遍历全队比较

去重条件：text + contextKey + deliveryContext 三者相同
```

### 过滤规则

```typescript
drainFormattedSystemEvents(params)
  ├─ 过滤 "reason periodic" 事件
  ├─ 过滤 "Read HEARTBEAT.md" 事件
  ├─ 过滤心跳轮询事件
  └─ 压缩 Node 事件中的 "last input" 部分
```

---

## 7. Phase 6 — 会话回收（Session Reaper）

**文件：** `cron/session-reaper.ts`

### 回收策略

```
sweepCronRunSessions({ cronConfig, sessionStorePath })
│
├─ 频率限制：每 5 分钟最多执行一次
├─ 保留时间：默认 24h（sessionRetention 可配置）
├─ 扫描范围：isCronRunSessionKey() 标记的会话
└─ 操作：删除过期会话记录 + 清理 Transcript
```

### 执行时机

```
onTimer() → 每次 tick 的最后一步
     └─ sweepCronRunSessions()
```

---

## 8. Phase 7 — 启动恢复（Startup Catchup）

**文件：** `cron/service/timer.ts`（markInterruptedStartupRun, runMissedJobs）

### 中断标记

Gateway 崩溃时 `runningAtMs` 标记未清除：

```
markInterruptedStartupRun(state, job, runningAtMs, nowMs)
  ├─ lastRunStatus = "error"
  ├─ lastError = "cron: job interrupted by gateway restart"
  ├─ consecutiveErrors++
  └─ nextRunAtMs = undefined（at 类型直接 disabled）
```

### 遗漏执行

```
runMissedJobs(state)
  ├─ 检查启动时 nextRunAtMs < now 的 job
  ├─ 默认最多执行 5 个遗漏 job（MAX_MISSED_JOBS_PER_RESTART）
  ├─ 每个遗漏 job 间隔 5s 执行（DEFAULT_MISSED_JOB_STAGGER_MS）
  └─ agentTurn 类型额外延迟 2min（DEFAULT_STARTUP_DEFERRED_MISSED_AGENT_JOB_DELAY_MS）
```

---

## 9. Phase 8 — 失败处理与告警（Failure Handling）

### 退避策略

```
errorBackoffMs = consecutiveErrors × DEFAULT_ERROR_BACKOFF_SCHEDULE_MS
```

每次连续失败，下次执行时间向后延迟，延迟量随失败次数线性增长。成功后重置。

### 告警策略

**文件：** `cron/service/failure-alerts.ts`

```
job.failureAlert = {
  after: 3,            // 连续 N 次失败后触发
  channel: "telegram", // 告警频道
  to: "@admin",        // 接收人
  cooldownMs: 3600000, // 冷却时间 1h，防止重复告警
  includeSkipped: true // skipped 是否计入失败次数
}
```

| 配置                  | 默认       | 作用                          |
| --------------------- | ---------- | ----------------------------- |
| `after`               | 无         | 连续多少次失败/跳过后触发告警 |
| `cooldownMs`          | 无         | 最短告警间隔                  |
| `mode`                | `announce` | 告警投递模式                  |
| `failureAlert: false` | —          | 禁用告警                      |

---

## 10. 防冲突机制（Anti-Conflict Mechanisms）

### 10.1 进程级互斥锁

```typescript
locked(state, fn)
  → 同一 cron service 实例下，所有 store 读写操作串行化
  → 防止并发 timer tick 导致的状态竞争
```

### 10.2 Active Job Marker

```
markCronJobActive(jobId, { preserveAcrossGenerationAdvance })
  → 进程内部标记 job 正在执行
  → collectRunnableJobs 会跳过 runningAtMs 有值的 job
  → 跨 Gateway 重启持久化标记（main session job）
```

### 10.3 最小 refire 间隔

```typescript
MIN_REFIRE_GAP_MS = 2000; // 2s
```

防止 `nextRunAtMs` 在同一个秒级内反复触发。

### 10.4 Job 去重（同 job 并发保护）

```typescript
job.state.runningAtMs !== undefined
  → collectRunnableJobs 会跳过该 job
  → 同一个 job 不会同时执行两次
```

### 10.5 定时器 Watchdog

```typescript
armRunningRecheckTimer(state)
  → 即使 onTimer 卡在 provider call 里
  → 最大 60s 后 Watchdog 重新触发检查
```

### 10.6 Stagger（防雷暴）

| 层次               | 机制                                         |
| ------------------ | -------------------------------------------- |
| 整点 Cron 自动偏移 | `isRecurringTopOfHourCronExpr()` → 默认 5min |
| 显式 stagger       | `schedule.staggerMs`                         |
| 启动遗漏 Job 偏移  | `DEFAULT_MISSED_JOB_STAGGER_MS = 5s`         |
| Agent 心跳相位     | Agent ID 哈希 → 自动分散在时间轴上           |

### 10.7 Session 级队列（ACP）

**文件：** `acp/control-plane/session-actor-queue.ts`

```typescript
SessionActorQueue.run(actorKey, op)
  → KeyedAsyncQueue
  → 同一 actorKey 的 op 串行执行（FIFO）
  → 不同 actorKey 的 op 并行执行
  → pending 计数暴露给监控
```

---

## 11. 文件索引与导入关系

```
                  ┌─────────────────────────────────────┐
                  │         Gateway Startup               │
                  │         CronService.start()          │
                  └────────────────┬────────────────────┘
                                   │
                  ┌────────────────▼────────────────┐
                  │       cron/service/ops.ts         │
                  │  start / stop / add / update /    │
                  │  remove / run / enqueueRun / list │
                  └────────┬───────────────┬────────┘
                           │               │
            ┌──────────────▼────┐   ┌──────▼──────────────┐
            │  cron/schedule.ts  │   │ cron/service/timer.ts│
            │  computeNextRunAt  │   │ armTimer / onTimer  │
            │  computePrevRunAt  │   │ executeJobCore      │
            │  Croner cache LRU  │   │ applyJobResult      │
            └────────────────────┘   │ runMissedJobs       │
                                     └────────┬────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────┐
                    │                         │                     │
                    ▼                         ▼                     ▼
         ┌──────────────────┐   ┌──────────────────────┐  ┌───────────────┐
         │ cron/stagger.ts   │   │ cron/service/jobs.ts  │  │cron/delivery*│
         │ 整点偏移          │   │ createJob / findJob   │  │ 投递计划     │
         │ 显式 stagger      │   │ isJobDue / recompute  │  │ 失败投递     │
         └──────────────────┘   └──────────────────────┘  └───────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                          ▼                   ▼                   ▼
              ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐
              │ cron/session-    │  │ cron/delivery-    │  │cron/run-log* │
              │ reaper.ts        │  │ plan.ts           │  │ 执行记录     │
              │ 过期会话回收     │  │ 投递方式解析      │  │ 持久化存储   │
              └──────────────────┘  └──────────────────┘  └──────────────┘

              ┌─────────────────────────────────────────────────────┐
              │               执行目标路由                            │
              │                                                     │
              │  systemEvent → infra/system-events.ts                │
              │    → enqueueSystemEventEntry(sessionKey, text)       │
              │    → drainSystemEventEntries() @ 回合边界            │
              │                                                     │
              │  agentTurn → cron/isolated-agent.ts                  │
              │    → create isolated session                         │
              │    → send message → wait → handle reply              │
              │                                                     │
              │  command → exec subprocess                           │
              │    → collect stdout/stderr → handle output           │
              └─────────────────────────────────────────────────────┘

              ┌─────────────────────────────────────────────────────┐
              │               心跳调度（独立于 CronService）          │
              │                                                     │
              │  infra/heartbeat-schedule.ts                         │
              │    → resolveHeartbeatPhaseMs() — hash-based phase   │
              │    → computeNextHeartbeatPhaseDueMs()               │
              │    → seekNextActivePhaseDueMs() — active hours gate │
              │                                                     │
              │  infra/heartbeat-runner.ts                           │
              │    → per-agent heartbeat dispatch                   │
              │    → heartbeat-reply handling                       │
              │    → heartbeat event broadcast                      │
              └─────────────────────────────────────────────────────┘

              ┌─────────────────────────────────────────────────────┐
              │               运行时去重 / 防冲突                       │
              │                                                     │
              │  cron/active-jobs.ts  → process-level marker        │
              │  acp/control-plane/session-actor-queue.ts           │
              │    → KeyedAsyncQueue per-session serialization      │
              └─────────────────────────────────────────────────────┘
```

### 源文件 → 编译后的映射

| 源文件                                         | 编译后                      |
| ---------------------------------------------- | --------------------------- |
| `src/cron/service.ts`                          | CronService 门面            |
| `src/cron/service/timer.ts`                    | `cron.service.timer*.js`    |
| `src/cron/service/ops.ts`                      | `cron.service.ops*.js`      |
| `src/cron/service/jobs.ts`                     | `cron.service.jobs*.js`     |
| `src/cron/schedule.ts`                         | `cron.schedule*.js`         |
| `src/cron/stagger.ts`                          | `cron.stagger*.js`          |
| `src/cron/session-reaper.ts`                   | `cron.session-reaper*.js`   |
| `src/cron/heartbeat-policy.ts`                 | `cron.heartbeat-policy*.js` |
| `src/cron/types.ts`                            | 类型定义（编译后无运行时）  |
| `src/infra/system-events.ts`                   | `system-events*.js`         |
| `src/infra/heartbeat-schedule.ts`              | `heartbeat-schedule*.js`    |
| `src/infra/heartbeat-runner.ts`                | `heartbeat-runner*.js`      |
| `src/infra/heartbeat-events.ts`                | `heartbeat-events*.js`      |
| `src/acp/control-plane/session-actor-queue.ts` | `session-actor-queue*.js`   |

---

## 附录：关键配置项

| 配置路径                                    | 影响                             |
| ------------------------------------------- | -------------------------------- |
| `cronConfig.enabled`                        | 是否启用 Cron Service            |
| `cronConfig.sessionRetention`               | 定时任务会话保留时间（默认 24h） |
| `cronConfig.failureDestination`             | 默认失败通知投递目标             |
| `agents.defaults.heartbeat.intervalMinutes` | 心跳间隔                         |
| `agents.defaults.heartbeat.activeHours`     | 心跳活跃时段                     |
| `agents.defaults.heartbeat.maxAckChars`     | 心跳回复最大字符数               |
| `schedule.everyMs`                          | 每个 Job 的循环间隔              |
| `schedule.staggerMs`                        | 每个 Job 的偏移量                |
| `schedule.tz`                               | Cron 表达式的时区                |
| `sessionRetention`                          | 会话回收保留时间                 |
