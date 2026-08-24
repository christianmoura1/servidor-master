/* Servidor Master — camada de interface.
   Troque apenas as funções marcadas como INTEGRAÇÃO para conectar a API Python. */

const config = window.SERVIDOR_MASTER_CONFIG;
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
const loginScreen = document.querySelector('#login-screen');
const commandScreen = document.querySelector('#command-screen');
const messages = document.querySelector('#messages');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const modal = document.querySelector('#confirm-modal');
const apiModal = document.querySelector('#api-modal');
let isTyping = false;
let pendingCommand = '';
let activeProvider = 'hermes';
const providerDefaults = {
  hermes: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', apiKey: '' },
  claude: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-5', apiKey: '' },
  external: { endpoint: '', model: '', apiKey: '' }
};
let providerConfigs = (() => {
  try {
    return { ...providerDefaults, ...(JSON.parse(sessionStorage.getItem('servidor-master-apis-v2') || 'null') || {}) };
  } catch {
    return structuredClone(providerDefaults);
  }
})();

const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const loginError = document.querySelector('#login-error');
const loginButton = document.querySelector('#login-form button[type="submit"]');
const signupButton = document.querySelector('#signup-button');

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthLoading(true);
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });

  if (error || !data.user || !(await claimAuthorizedAccess())) {
    await supabaseClient.auth.signOut();
    denyAccess(error ? 'E-mail ou senha incorretos.' : 'Este usuário não tem acesso ao painel.');
    setAuthLoading(false);
    return;
  }

  showCommandCenter();
  setAuthLoading(false);
});

signupButton.addEventListener('click', async () => {
  if (!emailInput.checkValidity() || passwordInput.value.length < 8) {
    denyAccess('Informe um e-mail válido e uma senha com pelo menos 8 caracteres.');
    return;
  }
  setAuthLoading(true);
  const { error } = await supabaseClient.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: { emailRedirectTo: window.location.origin }
  });
  loginError.textContent = error ? error.message : 'Cadastro iniciado. Confirme o link enviado ao seu e-mail.';
  setAuthLoading(false);
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  commandScreen.hidden = true;
  loginScreen.hidden = false;
  passwordInput.value = '';
  passwordInput.focus();
});

async function claimAuthorizedAccess() {
  const { data, error } = await supabaseClient.rpc('claim_servidor_master_access');
  return !error && data === true;
}

function showCommandCenter() {
  loginScreen.hidden = true;
  commandScreen.hidden = false;
  loginError.innerHTML = '&nbsp;';
  input.focus();
  refreshTelemetry();
}

function denyAccess(message) {
  const panel = document.querySelector('#login-panel');
  panel.classList.remove('is-denied');
  void panel.offsetWidth;
  panel.classList.add('is-denied');
  loginError.textContent = message;
  passwordInput.value = '';
  passwordInput.focus();
}

function setAuthLoading(active) {
  loginButton.disabled = active;
  signupButton.disabled = active;
  loginButton.firstChild.textContent = active ? 'Verificando... ' : 'Acessar sistema ';
}

// Restaura uma sessão válida sem pedir login novamente.
(async () => {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session && await claimAuthorizedAccess()) showCommandCenter();
})();

document.querySelector('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage();
});

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.danger) {
      pendingCommand = button.dataset.command;
      modal.hidden = false;
      document.querySelector('#cancel-restart').focus();
      return;
    }
    sendMessage(button.dataset.command);
  });
});

document.querySelectorAll('[data-provider]').forEach((button) => {
  button.addEventListener('click', () => selectProvider(button.dataset.provider));
});

document.querySelector('#api-settings').addEventListener('click', openApiModal);
document.querySelector('#cancel-api').addEventListener('click', closeApiModal);
apiModal.addEventListener('click', (event) => { if (event.target === apiModal) closeApiModal(); });
document.querySelector('#save-api').addEventListener('click', () => {
  const endpoint = document.querySelector('#api-endpoint').value.trim();
  const model = document.querySelector('#api-model').value.trim();
  const apiKey = document.querySelector('#api-key').value.trim();
  if (!endpoint.startsWith('https://') || !model || !apiKey) {
    document.querySelector('#api-key').focus();
    return;
  }
  providerConfigs[activeProvider] = { endpoint, model, apiKey };
  sessionStorage.setItem('servidor-master-apis-v2', JSON.stringify(providerConfigs));
  closeApiModal();
  selectProvider(activeProvider);
});

function selectProvider(provider) {
  activeProvider = provider;
  const current = providerConfigs[provider];
  const labels = {
    hermes: ['Hermes', 'H', current.apiKey ? `OpenRouter • ${current.model}` : 'configure o OpenRouter para iniciar'],
    claude: ['Claude Code', 'C', current.apiKey ? `Anthropic • ${current.model} • execução VPS pendente` : 'configure a Anthropic • execução VPS pendente'],
    external: ['API externa', '↗', current.apiKey ? `${current.model} conectado` : 'configure uma API compatível']
  };
  document.querySelectorAll('[data-provider]').forEach((button) => button.classList.toggle('active', button.dataset.provider === provider));
  document.querySelector('#assistant-name').textContent = labels[provider][0];
  document.querySelector('#assistant-avatar').textContent = labels[provider][1];
  document.querySelector('#connection-note').textContent = labels[provider][2];
  input.placeholder = `Mensagem para ${labels[provider][0]}...`;
}

function openApiModal() {
  const current = providerConfigs[activeProvider];
  const names = { hermes: 'Hermes / OpenRouter', claude: 'Claude / Anthropic', external: 'API externa' };
  document.querySelector('#api-title').textContent = `Configurar ${names[activeProvider]}`;
  document.querySelector('#api-endpoint-label').textContent = activeProvider === 'claude' ? 'Endpoint da Anthropic' : 'Endpoint compatível com OpenAI';
  document.querySelector('#api-endpoint').value = current.endpoint;
  document.querySelector('#api-model').value = current.model;
  document.querySelector('#api-key').value = '';
  document.querySelector('#api-key').placeholder = activeProvider === 'hermes' ? 'sk-or-v1-...' : 'Cole a chave deste provedor';
  apiModal.hidden = false;
}

function closeApiModal() { apiModal.hidden = true; }

document.querySelector('#cancel-restart').addEventListener('click', closeModal);
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
document.querySelector('#confirm-restart').addEventListener('click', () => {
  const command = pendingCommand;
  closeModal();
  sendMessage(command);
});

function closeModal() {
  pendingCommand = '';
  modal.hidden = true;
}

/**
 * Ponto central de integração do chat.
 * INTEGRAÇÃO: substitua o setTimeout por fetch('/api/chat', {...}).
 */
async function sendMessage(message = input.value) {
  const cleanMessage = String(message).trim();
  if (!cleanMessage || isTyping) return;

  appendMessage('user', cleanMessage);
  input.value = '';
  setTyping(true);

  try {
    const activeConfig = providerConfigs[activeProvider];
    if (!activeConfig.apiKey && !(activeProvider === 'hermes' && isTelemetryMessage(cleanMessage))) {
      throw new Error(`Configure a API de ${activeProvider === 'claude' ? 'Claude' : activeProvider === 'hermes' ? 'Hermes' : 'API externa'} antes de conversar.`);
    }
    const { data: sessionData } = await supabaseClient.auth.getSession();
    if (!sessionData.session) throw new Error('Sua sessão expirou. Entre novamente.');

    const response = await fetch(`${config.supabaseUrl}/functions/v1/servidor-master-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${sessionData.session.access_token}`
      },
      body: JSON.stringify({
        provider: activeProvider,
        message: cleanMessage,
        external: activeConfig
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o agente.');
    appendMessage('agent', result.message || 'Resposta vazia do agente.', result.code || '');
  } catch (error) {
    appendMessage('agent', `Não consegui concluir: ${error.message}`);
  } finally {
    setTyping(false);
  }
}

const telemetryTerms = [
  'memoria', 'memória', 'ram', 'cpu', 'processador', 'disco', 'servidor', 'vps', 'telemetria', 'status',
  'projeto', 'projetos', 'certponto', 'relatório de ponto', 'relatorio de ponto', 'banco de horas', 'ponto da equipe'
];

function isTelemetryMessage(message) {
  const normalized = String(message).toLowerCase();
  return telemetryTerms.some((term) => normalized.includes(term));
}

async function refreshTelemetry() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) return;
    const response = await fetch(`${config.supabaseUrl}/functions/v1/servidor-master-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${data.session.access_token}`
      },
      body: JSON.stringify({ provider: 'hermes', message: 'telemetria do servidor' })
    });
    const result = await response.json();
    if (!response.ok || !result.telemetry) return;
    const values = {
      cpu: Math.round(result.telemetry.cpu.percent),
      ram: Math.round(result.telemetry.memory.percent),
      disk: Math.round(result.telemetry.disk.percent)
    };
    for (const [name, value] of Object.entries(values)) {
      document.querySelector(`#${name}-value`).textContent = value;
      document.querySelector(`#${name}-meter`).style.width = `${value}%`;
    }
    document.querySelector('#robot-status').innerHTML = '<i class="pulse-dot"></i>Online';
  } catch {
    document.querySelector('#robot-status').innerHTML = '<i class="pulse-dot offline"></i>Offline';
  }
}

function appendMessage(author, text, code = '') {
  const row = document.createElement('article');
  row.className = `message-row ${author}`;
  const avatar = author === 'agent' ? '<div class="message-avatar" aria-hidden="true">M</div>' : '';
  const codeBlock = code ? `<div class="code-block"><div><span>terminal</span><button type="button" class="copy-code">Copiar</button></div><pre><code></code></pre></div>` : '';
  row.innerHTML = `${avatar}<div class="message-bubble"><p></p>${codeBlock}<time>${currentTime()}</time></div>`;
  row.querySelector('p').textContent = text;

  if (code) {
    row.querySelector('code').textContent = code;
    row.querySelector('.copy-code').addEventListener('click', async (event) => {
      await navigator.clipboard.writeText(code);
      event.currentTarget.textContent = 'Copiado';
      window.setTimeout(() => { event.currentTarget.textContent = 'Copiar'; }, 1400);
    });
  }

  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function setTyping(active) {
  isTyping = active;
  sendButton.disabled = active;
  document.querySelector('#typing-indicator')?.remove();
  if (!active) return;

  const indicator = document.createElement('div');
  indicator.id = 'typing-indicator';
  indicator.className = 'message-row agent';
  indicator.innerHTML = '<div class="message-avatar" aria-hidden="true">M</div><div class="typing-bubble" aria-label="Mordomo está digitando"><i></i><i></i><i></i></div>';
  messages.appendChild(indicator);
  messages.scrollTop = messages.scrollHeight;
}

function currentTime() {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

// Disponibiliza a função para integrações externas e testes no console.
window.sendMessage = sendMessage;

