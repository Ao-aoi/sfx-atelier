import { analyze, fromAudioBuffer } from '@sfx-atelier/analysis';

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
let activeBandSource = null;

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
  return { fileName: currentFileName, ...analyze(fromAudioBuffer(buffer)) };
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
  if(activeBandSource){try{activeBandSource.stop();}catch{}}
  const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();
  activeBandSource=source;
  const ranges=[['lowpass',250],['bandpass',Math.sqrt(250*4000)],['highpass',4000]];
  filter.type=ranges[index][0];filter.frequency.value=ranges[index][1];filter.Q.value=index===1?.55:.707;
  if(index===1) {filter.frequency.value=1125;filter.Q.value=.3;}
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
