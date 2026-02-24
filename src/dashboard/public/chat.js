const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');

function addMessage(role, content, streaming) {
  if (streaming === undefined) streaming = false;
  const el = document.createElement('div');
  el.className = 'message ' + role + (streaming ? ' streaming' : '');
  el.textContent = content;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = new Date().toLocaleTimeString();
  el.appendChild(meta);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  sendBtn.disabled = true;

  addMessage('user', text);
  const assistantEl = addMessage('assistant', '...', true);

  try {
    const res = await fetch('/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    var jobId = data.jobId;

    if (!jobId) {
      assistantEl.firstChild.textContent = 'Error: ' + (data.error || 'no jobId returned');
      assistantEl.classList.remove('streaming');
      sendBtn.disabled = false;
      return;
    }

    // Poll for output
    var lastSize = 0;
    var poll = setInterval(async function() {
      try {
        var out = await fetch('/api/jobs/' + jobId + '/output').then(function(r) { return r.json(); });
        if (out.output && out.output.length > lastSize) {
          assistantEl.firstChild.textContent = out.output.slice(-2000);
          lastSize = out.output.length;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (out.status && out.status !== 'running') {
          clearInterval(poll);
          assistantEl.classList.remove('streaming');
        }
      } catch (e) {
        // ignore poll errors
      }
    }, 2000);

    setTimeout(function() { clearInterval(poll); }, 300000); // 5 min max
  } catch (err) {
    assistantEl.firstChild.textContent = 'Error: ' + err.message;
    assistantEl.classList.remove('streaming');
  }

  sendBtn.disabled = false;
}

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
inputEl.addEventListener('input', function() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
});
