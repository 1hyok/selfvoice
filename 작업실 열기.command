#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if curl --silent --fail http://127.0.0.1:4317/api/state >/dev/null; then
  open 'http://127.0.0.1:4317'
  exit 0
fi
print '결 자소서 작업실을 시작합니다. 이 창을 열어 두세요.'
print '브라우저 주소: http://127.0.0.1:4317'
(sleep 2; open 'http://127.0.0.1:4317') &
node server.mjs
