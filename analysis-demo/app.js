const $ = (selector) => document.querySelector(selector);
const fileInput = $('#audio-file');
const dropZone = $('#drop-zone');
const workspace = $('#workspace');
const player = $('#audio-player');
let audioContext;
let decodedBuffer;
let currentFileName = '';
let analysisReport = null;
let objectUrl = null;

const fmt = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '—';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
});
['dragenter','dragover'].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault(); dropZone.classList.add('dragging');
}));
['dragleave','drop'].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault(); dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', e => {
  const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('audio/'));
  if (file) loadFile(file);
});

async function loadFile(file) {
  currentFileName = file.name;
  $('#file-meta').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  $('#track-name').textContent = file.name;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  player.src = objectUrl;
  workspace.classList.remove('hidden');
  $('#summary').textContent = '音声をデコードして特徴量を計算しています…';
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext ||= new AudioContextClass();
    const arrayBuffer = await file.arrayBuffer();
    decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    analysisReport = analyzeBuffer(decodedBuffer);
    renderReport(analysisReport);
  } catch (error) {
    console.error(error);
    $('#summary').textContent = 'この音声を読み込めませんでした。MP3またはWAV形式か確認してください。';
  }
}

function analyzeBuffer(buffer) {
  const sampleRate = buffer.sampleRate;
  const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] || 0;
    mono[i] = sum / channels.length;
  }
  const frameSize = 2048;
  const hop = 1024;
  const frames = [];
  let previousSpectrum = null;
  let rmsSum = 0, centroidSum = 0, rolloffSum = 0, zcrSum = 0, fluxSum = 0;
  const bandEnergy = [0, 0, 0];
  const spectrumFrames = [];

  for (let start = 0; start + frameSize < mono.length; start += hop) {
    const frame = mono.subarray(start, start + frameSize);
    let square = 0, crossings = 0;
    for (let i = 0; i < frame.length; i++) {
      square += frame[i] * frame[i];
      if (i && ((frame[i] >= 0) !== (frame[i - 1] >= 0))) crossings++;
    }
    const rms = Math.sqrt(square / frame.length);
    const spectrum = magnitudeSpectrum(frame);
    const binHz = sampleRate / frameSize;
    let total = 0, weighted = 0, cumulative = 0, rolloff = sampleRate / 2;
    let flux = 0;
    for (let k = 1; k < spectrum.length; k++) {
      const mag = spectrum[k];
      total += mag; weighted += mag * k * binHz;
      if (previousSpectrum) flux += Math.max(0, mag - previousSpectrum[k]);
      const hz = k * binHz;
      const band = hz < 250 ? 0 : hz < 4000 ? 1 : 2;
      bandEnergy[band] += mag * mag;
    }
    const threshold = total * 0.85;
    for (let k = 1; k < spectrum.length; k++) {
      cumulative += spectrum[k];
      if (cumulative >= threshold) { rolloff = k * binHz; break; }
    }
    const centroid = total ? weighted / total : 0;
    const zcr = crossings / frame.length;
    frames.push({time: start / sampleRate, rms, centroid, rolloff, zcr, flux});
    rmsSum += rms; centroidSum += centroid; rolloffSum += rolloff; zcrSum += zcr; fluxSum += flux;
    previousSpectrum = spectrum;
    if (frames.length % 3 === 0) spectrumFrames.push(spectrum);
  }
  const count = Math.max(1, frames.length);
  const rmsMean = rmsSum / count;
  const centroidMean = centroidSum / count;
  const rolloffMean = rolloffSum / count;
  const zcrMean = zcrSum / count;
  const fluxMean = fluxSum / count;
  const peak = Math.max(...frames.map(f => f.rms));
  const dynamicRange = peak > 0 && rmsMean > 0 ? 20 * Math.log10(peak / rmsMean) : 0;
  const stereo = channels.length > 1 ? stereoStats(channels[0], channels[1], sampleRate) : {correlation:1,width:0};
  const onset = frames.map(f => f.flux);
  const bpm = estimateTempo(onset, sampleRate / hop);
  const bandTotal = bandEnergy.reduce((a,b)=>a+b,0) || 1;
  const bandRatios = bandEnergy.map(v=>v/bandTotal);
  const transientRatio = frames.filter(f=>f.flux > fluxMean * 2.2).length / count;
  const tailRatio = estimateTailRatio(frames);
  const periodicity = estimateFluxPeriod(onset, sampleRate / hop);
  return {
    fileName: currentFileName, duration: buffer.duration, sampleRate, channels: channels.length,
    frameCount: count, rmsMean, centroidMean, rolloffMean, zcrMean, dynamicRange,
    stereo, bpm, bandRatios, transientRatio, tailRatio, periodicity,
    frames, spectrumFrames
  };
}

function magnitudeSpectrum(input) {
  const n = input.length;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i=0;i<n;i++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    re[i] = input[i] * window;
  }
  // Iterative radix-2 FFT.
  let j = 0;
  for (let i=1;i<n;i++) {
    let bit=n>>1;
    for (;j&bit;bit>>=1) j^=bit;
    j^=bit;
    if (i<j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for (let len=2;len<=n;len<<=1) {
    const angle=-2*Math.PI/len, wlenR=Math.cos(angle), wlenI=Math.sin(angle);
    for (let i=0;i<n;i+=len) {
      let wr=1,wi=0;
      for (let k=0;k<len/2;k++) {
        const uR=re[i+k],uI=im[i+k],vR=re[i+k+len/2]*wr-im[i+k+len/2]*wi,vI=re[i+k+len/2]*wi+im[i+k+len/2]*wr;
        re[i+k]=uR+vR; im[i+k]=uI+vI; re[i+k+len/2]=uR-vR; im[i+k+len/2]=uI-vI;
        const next=wr*wlenR-wi*wlenI; wi=wr*wlenI+wi*wlenR; wr=next;
      }
    }
  }
  const out=new Float32Array(n/2);
  for(let i=0;i<out.length;i++) out[i]=Math.hypot(re[i],im[i]);
  return out;
}

function stereoStats(left,right,sr) {
  const step=Math.max(1,Math.floor(left.length/50000));
  let lr=0,ll=0,rr=0,side=0,mid=0,n=0;
  for(let i=0;i<left.length;i+=step){const l=left[i],r=right[i],m=(l+r)/2,s=(l-r)/2;lr+=l*r;ll+=l*l;rr+=r*r;side+=s*s;mid+=m*m;n++;}
  return {correlation:lr/Math.sqrt((ll*rr)||1),width:Math.sqrt(side/(mid||1))};
}
function estimateTempo(onset, fps) {
  const minLag=Math.floor(fps*60/180),maxLag=Math.min(onset.length-2,Math.ceil(fps*60/55));
  let bestLag=0,best=-Infinity;
  for(let lag=minLag;lag<=maxLag;lag++){
    let sum=0;
    for(let i=lag;i<onset.length;i++) sum+=onset[i]*onset[i-lag];
    if(sum>best){best=sum;bestLag=lag;}
  }
  return bestLag ? 60*fps/bestLag : null;
}
function estimateTailRatio(frames) {
  const active=frames.filter(f=>f.rms>0.0001);
  if(!active.length)return 0;
  const peak=Math.max(...active.map(f=>f.rms));
  const late=active.filter(f=>f.rms<peak*0.16).length;
  return late/active.length;
}
function estimateFluxPeriod(onset,fps) {
  const min=Math.max(2,Math.floor(fps*.18)),max=Math.min(onset.length/2,Math.ceil(fps*1.2));
  let bestLag=0,best=0;
  for(let lag=min;lag<max;lag++){
    let sum=0;
    for(let i=lag;i<onset.length;i++)sum+=onset[i]*onset[i-lag];
    if(sum>best){best=sum;bestLag=lag;}
  }
  return bestLag ? bestLag/fps : null;
}

function renderReport(r) {
  $('#metrics').innerHTML = [
    ['DURATION', formatTime(r.duration)],['TEMPO EST.',r.bpm?fmt(r.bpm,0)+' BPM':'—'],
    ['SAMPLE RATE',(r.sampleRate/1000).toFixed(1)+' kHz'],['CHANNELS',r.channels===2?'STEREO':'MONO']
  ].map(([label,value])=>`<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
  const dominant = ['低域','中域','高域'][r.bandRatios.indexOf(Math.max(...r.bandRatios))];
  const stereoText = r.channels>1 ? (r.stereo.width>.22?'広がりのあるステレオ':r.stereo.width<.06?'中央寄りのステレオ':'中程度のステレオ幅') : 'モノラル';
  $('#summary').innerHTML = `<ul><li>エネルギーが最も多い帯域は<strong>${dominant}</strong>（低域 250Hz未満 / 中域 250–4kHz / 高域 4kHz以上）。</li><li>スペクトル重心は平均<strong>${fmt(r.centroidMean,0)}Hz</strong>で、音色の明るさを考える目安になります。</li><li>推定テンポは<strong>${r.bpm?fmt(r.bpm,0)+' BPM':'算出できず'}</strong>。拍が明瞭でない曲では誤差が大きくなります。</li><li>${stereoText}。ステレオ幅の推定値は ${fmt(r.stereo.width,2)} です。</li></ul>`;
  renderLayers(r);
  renderFeatures(r);
  renderEffects(r);
  drawSpectrogram(r);
}

function renderLayers(r) {
  const names=[
    {name:'LOW · 低域',range:'20–250 Hz',desc:'キック、ベース、低いシンセの基音や厚みが含まれやすい帯域。'},
    {name:'MID · 中域',range:'250–4,000 Hz',desc:'旋律・和音の中心、ピアノやシンセの胴鳴りなどが重なりやすい帯域。'},
    {name:'HIGH · 高域',range:'4,000–20,000 Hz',desc:'アタック、ベルのきらめき、シンバルやノイズ成分などが現れやすい帯域。'}
  ];
  $('#layers').innerHTML=names.map((x,i)=>`<div class="layer"><div><h3>${x.name}</h3><p>${x.range} · ${x.desc}</p></div><div class="layer-actions"><div class="level"><i style="width:${Math.round(r.bandRatios[i]*100)}%"></i></div><span class="muted">${Math.round(r.bandRatios[i]*100)}%</span><button data-band="${i}">この帯域を聴く</button></div></div>`).join('');
  $('#layers').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>playBand(Number(button.dataset.band),button)));
}
async function playBand(index,button) {
  if(!decodedBuffer)return;
  if(audioContext.state==='suspended')await audioContext.resume();
  const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();
  const ranges=[['lowpass',250],['bandpass',Math.sqrt(250*4000)],['highpass',4000]];
  filter.type=ranges[index][0];filter.frequency.value=ranges[index][1];filter.Q.value=index===1?.55:.707;
  if(index===1) {filter.frequency.value=1100;filter.Q.value=.5;}
  source.buffer=decodedBuffer;source.connect(filter).connect(gain).connect(audioContext.destination);gain.gain.value=.9;
  button.classList.add('active');button.textContent='再生中…';
  source.onended=()=>{button.classList.remove('active');button.textContent='この帯域を聴く';};
  source.start();
}
function renderFeatures(r) {
  const rows=[
    ['Spectral centroid',fmt(r.centroidMean,0)+' Hz','高いほど高周波成分の比率が大きい傾向。明るさの参考値。'],
    ['Spectral rolloff',fmt(r.rolloffMean,0)+' Hz','全スペクトルエネルギーの約85%が含まれる周波数。'],
    ['Zero-crossing rate',fmt(r.zcrMean,3),'波形がゼロを横切る頻度。ノイズ性・高周波成分の手がかり。'],
    ['Transient ratio',fmt(r.transientRatio*100,1)+'%','急激なスペクトル変化が見られたフレームの割合。'],
    ['Dynamic contrast',fmt(r.dynamicRange,1)+' dB','ピークRMSと平均RMSの比。音量変化の目安。']
  ];
  $('#feature-list').innerHTML=rows.map(([a,b,c])=>featureRow(a,b,c)).join('');
}
function renderEffects(r) {
  const reverb=r.tailRatio>.38;
  const delay=r.periodicity&&r.periodicity>.22&&r.periodicity<1.1;
  const stereo=r.channels>1&&r.stereo.width>.18;
  const rows=[
    ['余韻・持続音の兆候',reverb?'長い成分が多め':'長い成分は少なめ',reverb?'音量の低い成分が比較的長く続く。リバーブ、パッド、長い音符など複数の原因が考えられる。':'低い音量で続く成分は比較的少ない。リバーブが無いとは断定できない。',reverb],
    ['反復的な変化の兆候',delay?'周期性の候補あり':'明確な周期性なし',delay?'スペクトル変化に反復間隔の候補が見られる。ディレイのほか、リズムや反復フレーズでも起こる。':'明瞭な反復周期は検出されなかった。ディレイが無いことを意味しない。',delay],
    ['ステレオ拡張の兆候',stereo?'広がりあり':'限定的 / モノラル',r.channels>1?'左右の差分成分から幅を推定。パンニングやステレオ録音でも同様の値になる。':'モノラル音源のため、ステレオ幅は評価できない。',stereo],
    ['歪み・飽和', '現状は判定対象外','歪みの特定には倍音構造や波形のクリッピング検出が必要。高域成分やゼロ交差率だけでは判断しない。',false]
  ];
  $('#effect-list').innerHTML=rows.map(([a,b,c,flag])=>featureRow(a,b,c,flag)).join('');
}
function featureRow(title,value,description,flag=false){return `<div class="feature"><div><strong>${title}</strong><p>${description}</p></div><span class="pill ${flag?'':'warn'}">${value}</span></div>`;}
function drawSpectrogram(r) {
  const canvas=$('#spectrogram'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.fillStyle='#0d1119';ctx.fillRect(0,0,w,h);
  const frames=r.spectrumFrames;
  if(!frames.length)return;
  const cols=Math.min(w,frames.length),bins=frames[0].length;
  let max=0;for(const f of frames)for(let k=1;k<bins;k++)if(f[k]>max)max=f[k];
  for(let x=0;x<cols;x++){
    const f=frames[Math.floor(x*frames.length/cols)];
    for(let y=0;y<h;y++){
      const bin=Math.floor(Math.pow(1-y/h,2)*bins);
      const value=clamp(Math.log1p((f[bin]||0)*10)/Math.log1p(max*10),0,1);
      const hue=190-value*145,light=8+value*58;
      ctx.fillStyle=`hsl(${hue} 75% ${light}%)`;
      ctx.fillRect(x,h-y,Math.ceil(w/cols)+1,1);
    }
  }
  ctx.strokeStyle='#ffffff22';ctx.lineWidth=1;
  for(let i=1;i<5;i++){const y=h*i/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
}
function formatTime(seconds){const m=Math.floor(seconds/60),s=Math.floor(seconds%60);return `${m}:${String(s).padStart(2,'0')}`;}

$('#export-report').addEventListener('click',()=>{
  if(!analysisReport)return;
  const {frames,spectrumFrames,...summary}=analysisReport;
  const report={...summary,limitations:['Frequency bands are not instrument/source stems.','Effect clues are heuristic and are not reliable effect identification.','Instrument labels and emotional interpretation require listening or a trained model.'],listeningNotes:$('#listening-notes').value};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='sfx-atelier-analysis.json';a.click();URL.revokeObjectURL(url);
  $('#export-status').textContent='JSONを保存しました';
});
