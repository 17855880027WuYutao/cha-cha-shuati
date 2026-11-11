#!/bin/sh
# 在本机起一个静态服务，手机浏览器打开 http://127.0.0.1:8100/
cd "$(dirname "$0")"
exec python3 -m http.server 8100 --bind 127.0.0.1
