#!/bin/sh
# Test media for the e2e checks described in docs/02 (sections 8–13). Requires ffmpeg; speech needs macOS `say`.
set -e
cd "$(dirname "$0")/../fixtures"
ff() { ffmpeg -y -loglevel error "$@"; }
ff -f lavfi -i testsrc2=size=1280x720:rate=30:duration=6 -f lavfi -i sine=frequency=440:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest landscape.mp4
# Frame N in binary across 8 vertical stripes (bit k: stripe k white): which source frame a file shows, exactly, through
# any range or colour conversion
ff -f lavfi -i "color=c=black:s=640x360:r=30:d=6,format=yuv420p,geq=lum='if(bitand(N,pow(2,floor(X*8/W))),235,16)':cb=128:cr=128" -f lavfi -i sine=frequency=440:duration=6 -c:v libx264 -g 30 -pix_fmt yuv420p -c:a aac -shortest counter.mp4
# Files as phones make them (docs/11 §1.3). A portrait recording stored landscape with a display rotation (a white mark
# at the top left once turned); variable frame rate (30, then 15, then 60 fps; frame N in binary as in counter.mp4);
# mono 44.1 kHz sound; 5.1 sound; no sound at all.
ff -f lavfi -i "color=c=gray:s=360x640:r=30:d=4,drawbox=x=0:y=0:w=90:h=90:color=white:t=fill,format=yuv420p" -f lavfi -i sine=frequency=550:duration=4 -vf transpose=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest rotated_raw.mp4
ff -display_rotation -90 -i rotated_raw.mp4 -c copy rotated.mp4 && rm rotated_raw.mp4
ff -f lavfi -i "color=c=black:s=640x360:r=30:d=7,format=yuv420p,geq=lum='if(bitand(N,pow(2,floor(X*8/W))),235,16)':cb=128:cr=128,trim=end_frame=210,settb=1/600,setpts='if(lt(N,60),N/30,if(lt(N,90),2+(N-60)/15,4+(N-90)/60))/TB'" -f lavfi -i sine=frequency=440:duration=6 -fps_mode passthrough -enc_time_base:v 1/600 -c:v libx264 -pix_fmt yuv420p -video_track_timescale 600 -c:a aac -shortest vfr.mp4
ff -f lavfi -i testsrc2=size=640x360:rate=30:duration=4 -f lavfi -i "sine=frequency=330:duration=4:sample_rate=44100" -ac 1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest mono44.mp4
ff -f lavfi -i testsrc2=size=640x360:rate=30:duration=4 -f lavfi -i sine=frequency=330:duration=4 -filter_complex "[1:a]pan=5.1|FL=c0|FR=c0|FC=c0|LFE=0*c0|BL=c0|BR=c0[a]" -map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest surround.mp4
ff -f lavfi -i testsrc2=size=640x360:rate=30:duration=4 -c:v libx264 -pix_fmt yuv420p silent.mp4
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
# Reel in one tap (docs/08 A): talking with long pauses, an "эээ" and a repeated word; 1.5 s of silence at the start.
if command -v say >/dev/null && [ ! -f reel_ru.mp4 ]; then
  python3 -c "import json,sys; sys.stdout.write(json.load(open('../e2e/eval/texts.json'))['reel_ru_say'])" > reel_ru.txt
  say -v Milena -o reel_ru.aiff -f reel_ru.txt
  ff -f lavfi -t 1.5 -i anullsrc=r=22050:cl=mono -i reel_ru.aiff -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1,aresample=48000[a]" -map "[a]" reel_ru.wav
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 reel_ru.wav)
  ff -f lavfi -i "testsrc2=s=720x1280:r=30:d=$d" -i reel_ru.wav -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest reel_ru.mp4
  rm -f reel_ru.txt reel_ru.wav
fi
# Captions from a script (docs/09 S1): one script read verbatim, with two improvised lines, with a sentence skipped,
# and verbatim under music; what was actually said is in e2e/eval/texts.json (script_*_said).
if command -v say >/dev/null && [ ! -f script_music.mp4 ]; then
  bed=$(ls ../public/music/tracks/*.m4a | head -1)
  for v in verbatim adlib skip; do
    python3 -c "import json,sys; sys.stdout.write(json.load(open('../e2e/eval/texts.json'))['script_${v}_said'])" > script_$v.txt
    say -v Milena -o script_$v.aiff -f script_$v.txt
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 script_$v.aiff)
    ff -f lavfi -i "testsrc2=s=720x1280:r=30:d=$d" -i script_$v.aiff -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest script_$v.mp4
    rm -f script_$v.txt
  done
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 script_verbatim.aiff)
  ff -f lavfi -i "color=c=0x223344:s=720x1280:r=30:d=$d" -i script_verbatim.aiff -stream_loop -1 -i "$bed" -filter_complex "[1:a]aresample=48000[s];[2:a]aresample=48000,volume=0.35[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]" -map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest script_music.mp4
  rm -f script_*.aiff
fi
# Speech language detection (docs/08 A follow-up): ~8 s of speech in other languages, Ukrainian being the one closest to Russian.
if command -v say >/dev/null; then
  for lv in uk:Lesya es:Mónica de:Anna fr:Jacques it:Alice pt:Luciana tr:Yelda; do
    l=${lv%%:*}; v=${lv#*:}
    [ -f lang_$l.mp4 ] && continue
    python3 -c "import json,sys; sys.stdout.write(json.load(open('../e2e/eval/texts.json'))['lang_$l'])" > lang_$l.txt
    say -v "$v" -o lang_$l.aiff -f lang_$l.txt
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 lang_$l.aiff)
    ff -f lavfi -i "testsrc2=s=720x1280:r=30:d=$d" -i lang_$l.aiff -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest lang_$l.mp4
    rm -f lang_$l.txt lang_$l.aiff
  done
fi
# Audio/video sync (v1.2): white frames and 1 kHz beeps at exactly 1.0 s and 2.5 s.
if [ ! -f avsync.mp4 ]; then
  ff -f lavfi -i "color=c=black:s=720x1280:r=30:d=4" -f lavfi -i "aevalsrc='if(between(t,1,1.03)+between(t,2.5,2.53),0.5*sin(2*PI*1000*t),0)':s=48000:d=4" \
    -vf "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,1,1.032)+between(t,2.5,2.532)'" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest avsync.mp4
fi
# An iPhone-style HDR original (v1.2.2): HEVC Main 10, HLG, BT.2020 in a .mov — what "Format: Current" hands over.
if [ ! -f iphone_hdr.mov ] && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx265; then
  ff -f lavfi -i "smptehdbars=s=1920x1080:r=30:d=4" -f lavfi -i "sine=f=440:sample_rate=48000:d=4" -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p10le \
    -x265-params "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error" -color_primaries bt2020 -color_trc arib-std-b67 \
    -colorspace bt2020nc -b:v 8M -c:a aac -shortest iphone_hdr.mov
fi
# iPhone 16+ style audio (v1.3.1): a disabled 4-channel track the browser cannot decode first (stands in for spatial
# APAC), then the enabled stereo AAC track with a 1 kHz tone.
if [ ! -f iphone_spatial.mov ]; then
  ff -f lavfi -i "testsrc2=s=1280x720:r=30:d=4" -f lavfi -i "anullsrc=channel_layout=4.0:sample_rate=48000" -f lavfi -i "sine=f=1000:sample_rate=48000:d=4" \
    -map 0:v -map 1:a -map 2:a -c:v libx264 -pix_fmt yuv420p -c:a:0 alac -c:a:1 aac -ac:a:1 2 -disposition:a:0 0 -disposition:a:1 default -t 4 iphone_spatial.mov
fi
# QA (docs/11 §3.6): hostile inputs — random bytes, text and nothing under a video name, a video cut in half —
# and a 48 MP photo (iPhone "48MP" mode) for the decoded-image memory cap.
if [ ! -f hostile_random.mp4 ]; then
  python3 -c "import random,sys; random.seed(7); sys.stdout.buffer.write(bytes(random.getrandbits(8) for _ in range(200000)))" > hostile_random.mp4
  printf 'not a video, just text\n' > hostile_text.mp4
  : > hostile_empty.mp4
  ff -i landscape.mp4 -c copy -movflags +faststart half_tmp.mp4 # header first, like a download cut short
  head -c $(( $(wc -c < half_tmp.mp4) / 2 )) half_tmp.mp4 > hostile_half.mp4 && rm half_tmp.mp4
fi
if [ ! -f photo_48mp.jpg ]; then
  ff -f lavfi -i "testsrc2=s=8064x6048" -frames:v 1 -q:v 3 photo_48mp.jpg
fi
echo "fixtures ready: $(ls | wc -l | tr -d ' ') files"

# Performance benchmark (docs/04): S1 = four 60 s 1080p clips; S2 (PERF_S2=1) = one 15 min 720p clip.
for i in 1 2 3 4; do
  [ -f long_$i.mp4 ] || ffmpeg -v error -f lavfi -i "testsrc2=s=1920x1080:r=30:d=60" -f lavfi -i "sine=f=$((200*i)):d=60" -filter_complex "[0:v]noise=alls=20:allf=t+u,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -b:v 8M -maxrate 8M -bufsize 16M -g 30 -c:a aac -b:a 128k -shortest long_$i.mp4
done
if [ -n "$PERF_S2" ] && [ ! -f long_15m.mp4 ]; then
  ffmpeg -v error -f lavfi -i "testsrc2=s=1280x720:r=30:d=900" -f lavfi -i "sine=f=330:d=900" -filter_complex "[0:v]noise=alls=12:allf=t+u,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -b:v 2500k -maxrate 2500k -bufsize 5M -g 30 -c:a aac -b:a 96k -shortest long_15m.mp4
fi
