(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const form = $('#briefForm');
  const urlList = $('#urlList');
  const fileList = $('#fileList');
  const pdfInput = $('#pdfInput');
  const photoInput = $('#photoInput');
  const photoList = $('#photoList');
  const jobsEl = $('#jobList');
  const files = [];
  const photos = [];
  let activeJob = null;
  let pollTimer = null;

  function addUrl(value = '') {
    if (urlList.children.length >= 5) return;
    const row = document.createElement('div');
    row.className = 'url-row';
    row.innerHTML = `<input type="url" inputmode="url" placeholder="https://example.com/profile" aria-label="参考URL" value="${escapeAttr(value)}"><button type="button" class="icon-button" aria-label="URLを削除">×</button>`;
    row.querySelector('button').addEventListener('click', () => { row.remove(); if (!urlList.children.length) addUrl(); });
    urlList.append(row);
  }

  function escapeAttr(value) {
    return String(value).replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
  }

  function showError(message) {
    const el = $('#formError'); el.textContent = message; el.hidden = !message;
  }

  function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`; }
  function renderFiles() {
    fileList.innerHTML = '';
    files.forEach((file, index) => {
      const item = document.createElement('div'); item.className = 'file-item';
      item.innerHTML = `<span>PDF · ${escapeAttr(file.name)} <small>${formatBytes(file.size)}</small></span><button type="button" aria-label="${escapeAttr(file.name)}を削除">×</button>`;
      item.querySelector('button').onclick = () => { files.splice(index, 1); renderFiles(); };
      fileList.append(item);
    });
  }

  async function readFiles() {
    return Promise.all(files.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',')[1] });
      reader.onerror = () => reject(new Error(`${file.name}を読み込めませんでした。`));
      reader.readAsDataURL(file);
    })));
  }

  function renderPhotos() {
    photoList.innerHTML='';
    const labels={portrait:'顔写真',work:'仕事',community:'交流',sport:'スポーツ',context:'その他'};
    photos.forEach((photo,index)=>{const item=document.createElement('div');item.className='photo-item';item.innerHTML=`<img src="${photo.preview}" alt=""><div><b>${escapeAttr(photo.file.name)}</b><small>${formatBytes(photo.file.size)}</small><label><span>写真の役割</span><select>${Object.entries(labels).map(([v,l])=>`<option value="${v}"${photo.role===v?' selected':''}>${l}</option>`).join('')}</select></label></div><button type="button" aria-label="${escapeAttr(photo.file.name)}を削除">×</button>`;item.querySelector('select').onchange=e=>photo.role=e.target.value;item.querySelector('button').onclick=()=>{URL.revokeObjectURL(photo.preview);photos.splice(index,1);renderPhotos();};photoList.append(item);});
  }

  async function readPhotos(){return Promise.all(photos.map(({file,role})=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,mime:file.type,role,base64:String(reader.result).split(',')[1]});reader.onerror=()=>reject(new Error(`${file.name}を読み込めませんでした。`));reader.readAsDataURL(file);})));}

  function validate(provider) {
    showError('');
    const urls = [...urlList.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    for (const url of urls) { try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { return `URLの形式を確認してください：${url}`; } }
    const hasInput = form.elements.personName.value.trim() || urls.length || files.length || photos.length || form.elements.notes.value.trim();
    if (!hasInput && provider !== 'demo') return '氏名、URL、PDF、補足のいずれかを入力してください。';
    return '';
  }

  async function createJob(provider) {
    const validationError = validate(provider);
    if (validationError) { showError(validationError); return; }
    const button = provider === 'demo' ? $('#demoButton') : $('#generateButton');
    button.disabled = true;
    try {
      const payload = provider === 'demo' ? {
        personName: '青山 遥', company: '架空デモ株式会社', title: '代表取締役', urls: [], notes: '操作確認用の架空デモです。', pdfs: [], photos: [], provider
      } : {
        personName: form.elements.personName.value.trim(), company: form.elements.company.value.trim(), title: form.elements.title.value.trim(),
        urls: [...urlList.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean), notes: form.elements.notes.value.trim(), pdfs: await readFiles(), photos: await readPhotos(), provider
      };
      const response = await fetch('/api/jobs', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '生成を開始できませんでした。入力内容を確認してください。');
      setActiveJob(data.job);
      await loadJobs();
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; }
  }

  function stageProgress(job) {
    const stages = { queued:[1,8,'生成を待っています'], extracting:[2,24,'URLとPDFから情報を読み取っています'], collecting:[2,24,'参照情報を読み取っています'], analyzing:[3,44,'人物像と根拠を整理しています'], generating:[3,54,'人物分析と5つの方向を生成しています'], planning:[3,54,'5つの表現方向を設計しています'], rendering:[4,78,'提案書とサイトを組み立てています'], validating:[5,92,'ページとリンクを確認しています'], completed:[5,100,'生成が完了しました'] };
    return stages[job.stage] || (job.status === 'running' ? [3,50,'生成しています'] : [1,8,'準備しています']);
  }

  function showOnly(id) { ['emptyState','progressState','viewerState'].forEach(x => $(`#${x}`).hidden = x !== id); }
  function setActiveJob(job) {
    activeJob = job;
    clearTimeout(pollTimer);
    if (job.status === 'completed') { showViewer(job); return; }
    if (job.status === 'failed' || job.status === 'cancelled') { showOnly('emptyState'); showError(job.error || '生成を完了できませんでした。案件履歴から再度お試しください。'); return; }
    showOnly('progressState');
    const [step, width, label] = stageProgress(job);
    $('#progressNumber').textContent = step; $('#progressStage').textContent = label; $('#progressBar').style.width = `${width}%`;
    pollTimer = setTimeout(() => refreshJob(job.id), 1500);
  }

  async function refreshJob(id) {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('案件の状態を取得できませんでした。');
      const { job } = await response.json(); setActiveJob(job); await loadJobs();
    } catch (error) { showError(error.message); pollTimer = setTimeout(() => refreshJob(id), 3500); }
  }

  function outputUrl(job, key) {
    const root = job.proposalUrl ? job.proposalUrl.replace(/\/proposal\/index\.html(?:\?.*)?$/, '') : `/outputs/${job.id}`;
    return key === 'proposal' ? `${root}/proposal/index.html` : `${root}/sites/${key}/index.html`;
  }
  function showViewer(job) {
    showOnly('viewerState'); showError('');
    const tabs = $('#outputTabs'); tabs.innerHTML = '';
    const outputs=[['proposal','提案書'],...(job.concepts?.length===5?job.concepts.map(x=>[x.id,`${x.id} ${x.name||x.label}`]):[['01','01 案'],['02','02 案'],['03','03 案'],['04','04 案'],['05','05 案']])];
    outputs.forEach(([key,label], index) => {
      const button = document.createElement('button'); button.type='button'; button.textContent=label;
      button.onclick = () => selectOutput(job,key,button);
      tabs.append(button); if (!index) selectOutput(job,key,button);
    });
    $('#downloadOutput').href = job.downloadUrl || `/api/jobs/${job.id}/download`;
  }
  function selectOutput(job, key, button) {
    [...$('#outputTabs').children].forEach(b => b.classList.toggle('active', b === button));
    const url = outputUrl(job,key); $('#outputFrame').src = url; $('#openOutput').href = url;
  }

  async function loadJobs() {
    try {
      const response = await fetch('/api/jobs'); if (!response.ok) throw new Error();
      const { jobs } = await response.json(); jobsEl.innerHTML = '';
      if (!jobs.length) { jobsEl.innerHTML = '<p class="history-empty">まだ案件はありません。最初の5案を生成してみましょう。</p>'; return; }
      jobs.forEach(job => {
        const item = document.createElement('article'); item.className='job-item'; item.tabIndex=0;
        const date = new Date(job.createdAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
        item.innerHTML=`<div><b>${escapeAttr(job.personName || '名称未設定')}</b><small>${date} · ${escapeAttr(job.stage || job.status)}</small></div><span class="job-status ${job.status}">${job.status.toUpperCase()}</span>`;
        item.onclick=()=>refreshJob(job.id); item.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();refreshJob(job.id)}}; jobsEl.append(item);
      });
    } catch { jobsEl.innerHTML='<p class="history-empty">案件履歴を読み込めません。サーバーへの接続を確認してください。</p>'; }
  }

  async function checkHealth(attempt = 0) {
    try {
      const r=await fetch('/api/health'); const d=await r.json(); if(!r.ok||!d.ok)throw new Error();
      const states={
        authenticated:['state-dot ok','Codex 認証済み'],
        available:['state-dot','Codex CLI確認済み・認証要確認'],
        checking:['state-dot','Codexの認証を確認中'],
        unauthenticated:['state-dot error','Codexへのログインが必要です'],
        unavailable:['state-dot error','Codex CLIを利用できません']
      };
      const [className,label]=states[d.codex]||['state-dot error','Codexの状態を確認できません'];
      $('#healthDot').className=className; $('#healthText').textContent=label;
      if(d.codex==='checking'&&attempt<3)setTimeout(()=>checkHealth(attempt+1),2000);
    }
    catch { $('#healthDot').className='state-dot error'; $('#healthText').textContent='生成環境に接続できません'; }
  }

  form.addEventListener('submit', e => { e.preventDefault(); createJob('codex'); });
  $('#demoButton').onclick = () => createJob('demo'); $('#addUrl').onclick = () => addUrl();
  form.elements.notes.addEventListener('input', e => $('#notesCount').textContent=`${e.target.value.length.toLocaleString()} / 6,000`);
  pdfInput.addEventListener('change', () => { showError(''); for (const file of pdfInput.files) { if(files.length>=3){showError('PDFは3件まで追加できます。');break} if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){showError(`${file.name}はPDFではありません。`);continue} if(file.size>8*1024*1024){showError(`${file.name}は8MBを超えています。`);continue} files.push(file) } pdfInput.value='';renderFiles(); });
  photoInput.addEventListener('change',()=>{showError('');for(const file of photoInput.files){if(photos.length>=5){showError('写真は5枚まで追加できます。');break}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){showError(`${file.name}はJPEG、PNG、WebPではありません。`);continue}if(file.size>4*1024*1024){showError(`${file.name}は4MBを超えています。`);continue}photos.push({file,role:photos.length?'context':'portrait',preview:URL.createObjectURL(file)});}photoInput.value='';renderPhotos();});
  document.querySelectorAll('.view-toggle button').forEach(button => button.onclick=()=>{document.querySelectorAll('.view-toggle button').forEach(b=>b.classList.toggle('active',b===button));$('#deviceFrame').classList.toggle('mobile',button.dataset.width==='mobile')});
  $('#refreshJobs').onclick=loadJobs;
  if(location.hostname==='ceo-knowledgeweb.autopilot-note.com'){const button=document.createElement('button');button.type='button';button.className='remote-logout';button.textContent='ログアウト';button.onclick=async()=>{button.disabled=true;try{await fetch('/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});}finally{location.assign('/login');}};document.querySelector('.topbar')?.append(button);}
  addUrl(); checkHealth(); loadJobs();
})();
