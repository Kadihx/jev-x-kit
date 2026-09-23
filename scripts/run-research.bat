@echo off
cd /d "C:\Users\burak\OneDrive\Masaüstü\jev-x-kit"
for /f "delims=" %%t in ('gh auth token') do set GITHUB_TOKEN=%%t
node scripts\deep-repo-research.mjs >> artifacts\deep-research.log 2>&1
