# 本地 peer pin：0.2.1-rc.3

DSH 0.2.1-rc.3 的兼容门禁把插件 `peerDependencies` 里所有 `@deepseek-ai/dsh*` 声明当成 **运行时版本范围**（`semver.satisfies(runtime, range, {includePrerelease:true})`）。上游 main 仍钉 `0.2.1-rc.2`，所以启动时会被拒绝加载，并从 `dsh.profile.bundles` 摘掉。

本机已把下面三项改成精确 `0.2.1-rc.3`，并在部署目录 / clone 用 pnpm 落地了同版本副本：

- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-typert-protocol`

`@deepseek-ai/cordis` 仍是 `~4.0.5`（门禁不看它）。

## 同步上游后必须重打

```powershell
cd D:\Desktop\Agents\plugin\dsh-chat-actions
git pull --ff-only origin main
# 再把 package.json 里上述三项改回 0.2.1-rc.3
node D:\Desktop\Agents\tools\sync-deployed.mjs `
  D:\Desktop\Agents\plugin\dsh-chat-actions `
  C:\Users\Tomoto\.dsh\local-plugins\dsh-chat-actions
pnpm --dir C:\Users\Tomoto\.dsh\local-plugins\dsh-chat-actions add --save-exact --ignore-scripts --no-lockfile `
  @deepseek-ai/dsh-llm@0.2.1-rc.3 `
  @deepseek-ai/dsh-session@0.2.1-rc.3 `
  @deepseek-ai/dsh-typert-protocol@0.2.1-rc.3
# 然后把部署目录 package.json 的 dependencies 清掉（如被 pnpm 写进去），只保留 peer 精确 pin
```

## 回滚

```powershell
git -C D:\Desktop\Agents\plugin\dsh-chat-actions checkout -- package.json
Copy-Item C:\Users\Tomoto\.dsh\local-plugins\dsh-chat-actions\package.json.rc2.bak `
  C:\Users\Tomoto\.dsh\local-plugins\dsh-chat-actions\package.json -Force
```
