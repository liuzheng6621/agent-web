# 一键：给一个网址，看看这台站点能被测成什么样。
#
#   pwsh -File quickstart.ps1 http://127.0.0.1:8080
param([Parameter(Mandatory = $true)][string]$Url)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '没找到 node。这个项目只依赖 Node 20 以上，不装任何第三方包。'
    exit 2
}

$major = [int](& node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
    Write-Host "node 版本是 $(& node -v)，需要 20 以上。"
    exit 2
}

$out = './agent-web-site'
Write-Host "目标：$Url"
Write-Host "输出：$out"
Write-Host ''

& node bin/agent-web.mjs discover $Url --out=$out --run --detail
$status = $LASTEXITCODE

Write-Host ''
if (Test-Path "$out/cases") {
    Write-Host '接下来三步：'
    Write-Host '  1. 看一眼生成的适配器和案例（生成的东西都标了 inferred，别当事实）'
    Write-Host "       Get-ChildItem $out/cases"
    Write-Host '  2. 确认案例（不确认不出判决）'
    Write-Host "       node bin/agent-web.mjs accept $out/cases/<某个>.json --by=<你的名字>"
    Write-Host '  3. 跑判决'
    Write-Host "       node bin/agent-web.mjs verify $out/cases --adapter=$out/adapter.mjs"
}

exit $status
