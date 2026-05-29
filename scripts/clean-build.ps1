$ErrorActionPreference = 'SilentlyContinue'

Get-Process Soundboard -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process 'Soundboard-Setup' -ErrorAction SilentlyContinue | Stop-Process -Force

if (Test-Path 'dist') {
  Remove-Item -Recurse -Force 'dist'
}
