#!/bin/sh
# Test media for the e2e checks described in docs/02 (sections 8–13). Requires ffmpeg; speech needs macOS `say`.
set -e
cd "$(dirname "$0")/../fixtures"
ff() { ffmpeg -y -loglevel error "$@"; }
ff -f lavfi -i testsrc2=size=1280x720:rate=30:duration=6 -f lavfi -i sine=frequency=440:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest landscape.mp4
ff -f lavfi -i "smptebars=size=720x1280:rate=30:duration=5" -f lavfi -i sine=frequency=660:duration=5 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest portrait.mp4
ff -f lavfi -i "sine=frequency=220:duration=10" -c:a aac music.m4a
ff -f lavfi -i "mandelbrot=size=1080x1080" -frames:v 1 photo.png
# 120 BPM kick track with the first beat at 0.25 s (beat detection)
ff -f lavfi -i "aevalsrc='0.8*exp(-40*mod(t-0.25,0.5))*sin(2*PI*60*t)+0.3*exp(-60*mod(t-0.5,1))*(random(0)-0.5)':s=48000:d=12" -c:a aac beat120.m4a
# A person for background removal and a 16:9 shot where they walk left → right (auto reframe)
[ -f person.jpg ] || curl -sL -o person.jpg https://storage.googleapis.com/mediapipe-assets/business-person.png
ff -loop 1 -i person.jpg -f lavfi -i color=c=0x556677:s=1280x720:d=5:r=30 -filter_complex "[0:v]scale=-2:640,format=yuv420p[p];[1:v][p]overlay=x='50+t*150':y=80:shortest=1" -t 5 -r 30 -pix_fmt yuv420p -c:v libx264 walk.mp4
if command -v say >/dev/null; then
  say -v Samantha -o en.aiff "Hello and welcome to Kadr. This editor runs entirely on your phone. Your videos never leave the device."
  say -v Milena -o ru.aiff "Привет! Это видеоредактор Кадр. Всё работает прямо на телефоне."
  for l in en ru; do
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $l.aiff)
    ff -f lavfi -i "color=c=0x334455:s=720x1280:r=30:d=$d" -i $l.aiff -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest speech_$l.mp4
  done
  # speech + 1.2 s of silence + speech (pause removal); speech + pink noise (noise reduction)
  ff -i en.aiff -f lavfi -t 1.2 -i anullsrc=r=22050:cl=mono -i ru.aiff -filter_complex "[0:a]aresample=48000[a];[1:a]aresample=48000[b];[2:a]aresample=48000[c];[a][b][c]concat=n=3:v=0:a=1" -c:a aac speech_pauses.m4a
  ff -i en.aiff -f lavfi -i "anoisesrc=color=pink:amplitude=0.08:d=12" -filter_complex "[0:a]aresample=48000,apad=pad_dur=2[s];[1:a]aresample=48000[n];[s][n]amix=inputs=2:duration=shortest:normalize=0" -c:a aac noisy_en.m4a
fi
# Caption eval (docs/06 M5): a ~40 s vlog read by TTS, clean and under music at about -10 dB (texts in e2e/eval/texts.json).
if command -v say >/dev/null && [ ! -f eval_ru_music.mp4 ]; then
  bed=$(ls ../public/music/tracks/*.m4a | head -1)
  for l in ru en; do
    v=$([ $l = ru ] && echo Milena || echo Samantha)
    python3 -c "import json,sys; sys.stdout.write(json.load(open('../e2e/eval/texts.json'))['$l'])" > eval_$l.txt
    say -v $v -o eval_$l.aiff -f eval_$l.txt
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 eval_$l.aiff)
    ff -f lavfi -i "color=c=0x223344:s=720x1280:r=30:d=$d" -i eval_$l.aiff -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest eval_$l.mp4
    ff -f lavfi -i "color=c=0x223344:s=720x1280:r=30:d=$d" -i eval_$l.aiff -stream_loop -1 -i "$bed" -filter_complex "[1:a]aresample=48000[s];[2:a]aresample=48000,volume=0.35[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]" -map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest eval_${l}_music.mp4
    [ $l = ru ] && ff -f lavfi -i "color=c=0x223344:s=720x1280:r=30:d=$d" -i eval_$l.aiff -stream_loop -1 -i "$bed" -filter_complex "[1:a]aresample=48000[s];[2:a]aresample=48000,volume=1.0[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]" -map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest eval_ru_loud.mp4
    rm -f eval_$l.txt
  done
fi
echo "fixtures ready: $(ls | wc -l | tr -d ' ') files"

# Performance benchmark (docs/04): S1 = four 60 s 1080p clips; S2 (PERF_S2=1) = one 15 min 720p clip.
for i in 1 2 3 4; do
  [ -f long_$i.mp4 ] || ffmpeg -v error -f lavfi -i "testsrc2=s=1920x1080:r=30:d=60" -f lavfi -i "sine=f=$((200*i)):d=60" -filter_complex "[0:v]noise=alls=20:allf=t+u,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -b:v 8M -maxrate 8M -bufsize 16M -g 30 -c:a aac -b:a 128k -shortest long_$i.mp4
done
if [ -n "$PERF_S2" ] && [ ! -f long_15m.mp4 ]; then
  ffmpeg -v error -f lavfi -i "testsrc2=s=1280x720:r=30:d=900" -f lavfi -i "sine=f=330:d=900" -filter_complex "[0:v]noise=alls=12:allf=t+u,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -b:v 2500k -maxrate 2500k -bufsize 5M -g 30 -c:a aac -b:a 96k -shortest long_15m.mp4
fi
