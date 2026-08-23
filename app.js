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
let externalConfig = { endpoint: '', model: '', apiKey: '' };

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
  externalConfig = { endpoint, model, apiKey };
  closeApiModal();
  selectProvider(activeProvider === 'claude' ? 'external' : activeProvider);
});

function selectProvider(provider) {
  activeProvider = provider;
  const labels = {
    hermes: ['Hermes', 'H', externalConfig.apiKey ? 'OpenRouter configurado' : 'configure o OpenRouter para iniciar'],
    claude: ['Claude Code', 'C', 'conversa via Claude • execução VPS pendente'],
    external: ['API externa', '↗', externalConfig.apiKey ? `${externalConfig.model} conectado` : 'configure uma API compatível']
  };
  document.querySelectorAll('[data-provider]').forEach((button) => button.classList.toggle('active', button.dataset.provider === provider));
  document.querySelector('#assistant-name').textContent = labels[provider][0];
  document.querySelector('#assistant-avatar').textContent = labels[provider][1];
  document.querySelector('#connection-note').textContent = labels[provider][2];
  input.placeholder = `Mensagem para ${labels[provider][0]}...`;
}

function openApiModal() {
  document.querySelector('#api-endpoint').value = externalConfig.endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  document.querySelector('#api-model').value = externalConfig.model || 'deepseek/deepseek-chat-v3-0324:free';
  document.querySelector('#api-key').value = '';
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
    if ((activeProvider === 'hermes' || activeProvider === 'external') && !externalConfig.apiKey) {
      throw new Error('Configure a API externa antes de conversar com este agente.');
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
        external: activeProvider === 'claude' ? undefined : externalConfig
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
