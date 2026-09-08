#!/usr/bin/env bash
# 시뮬레이터/실기기 화면 녹화를 영상에 끼울 프레임 시퀀스로 바꾼다.
#
#   scripts/import-capture.sh <녹화파일> <장면id> [시작초] [길이초]
#
# 예) scripts/import-capture.sh ~/map.mov s2 3 5.2
#     assets/capture/s2/f0001.jpg … 를 30fps 로 만든다.
#
# 장면 id 는 src/index.html 의 data-capture 값과 같아야 한다 (s2 지도 / s3 상세 /
# s4 캘린더 / s5 주차). 녹화 원본은 저장소에 넣지 않는다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FF="$HERE/node_modules/ffmpeg-static/ffmpeg"
FPS=30
WIDTH=808   # 폰 프레임 폭(404px)의 2배

src="${1:?녹화 파일 경로가 필요하다}"
id="${2:?장면 id 가 필요하다 (s2|s3|s4|s5)}"
start="${3:-0}"
dur="${4:-5.2}"

[ -x "$FF" ] || { echo "ffmpeg-static 이 없다. portfolio-demo 에서 npm install 먼저."; exit 1; }
[ -f "$src" ] || { echo "파일을 찾을 수 없다: $src"; exit 1; }

# 원본 해상도를 읽어 폰 프레임 비율을 알려준다(ffprobe 없이 stderr 파싱).
res="$("$FF" -hide_banner -i "$src" 2>&1 |
  awk 'match($0, /[0-9][0-9][0-9]+x[0-9][0-9][0-9]+/){print substr($0, RSTART, RLENGTH); exit}' || true)"
out="$HERE/assets/capture/$id"
rm -rf "$out"; mkdir -p "$out"

"$FF" -hide_banner -loglevel error -ss "$start" -t "$dur" -i "$src" \
  -vf "fps=$FPS,scale=$WIDTH:-2:flags=lanczos" -q:v 3 \
  "$out/f%04d.jpg"

n="$(find "$out" -name 'f*.jpg' | wc -l)"
echo "프레임 $n 장 -> assets/capture/$id/"

if [ -n "$res" ]; then
  w="${res%x*}"; h="${res#*x}"
  ph="$(awk -v w="$w" -v h="$h" 'BEGIN{printf "%d", 404*h/w}')"
  echo "원본 $res — 이 비율이면 src/index.html 의 .phone 높이를 ${ph}px 로 맞춘다 (현재 800px)."
fi
echo "index.html 에 넣을 요소:"
echo "  <img class=\"pcap\" data-capture=\"$id\" data-cap-frames=\"$n\" alt=\"\">"
