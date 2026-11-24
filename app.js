import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ================= Firebase ================= */
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
auth.languageCode = "pt";
const db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

/* ================= utilidades ================= */
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const brl = v => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fmt = s => { if (!s) return ""; const d = parse(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const fmtLong = s => { if (!s) return ""; const d = parse(s); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoje = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const hojeIso = () => iso(hoje());
const agoraHM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
const inicioSemana = d => addDays(d, -((d.getDay() + 6) % 7));
const $ = id => document.getElementById(id);
const val = id => $(id).value.trim();
const num = id => Number(String($(id).value).replace(",", ".")) || 0;

/* ================= estado ================= */
const CONFIG_PADRAO = { nome: "", crp: "", cidade: "Rio de Janeiro", valorHoraSala: 40, despesas: [], ultimoBackup: "", configurado: false };
const COLECOES = ["pacientes", "sessoes", "documentos", "supervisoes", "formacoes"];
const state = {
  user: null, config: { ...CONFIG_PADRAO }, carregado: new Set(),
  pacientes: [], sessoes: [], documentos: [], supervisoes: [], formacoes: [],
  mes: { y: hoje().getFullYear(), m: hoje().getMonth() },
  semana: inicioSemana(hoje()),
  filtro: "atendimento", busca: "", paciente: null, modoLogin: "entrar", nomeCadastro: ""
};
let desligar = [];

/* ================= gravação ================= */
const uid = () => state.user.uid;
const ref = (col, id) => doc(db, "users", uid(), col, id);
const novoId = col => doc(collection(db, "users", uid(), col)).id;
const falha = e => { console.error(e); toast("Não foi possível salvar. Confira a conexão e tente de novo."); };
const gravar = (col, id, dados) => setDoc(ref(col, id), dados, { merge: true }).catch(falha);
const alterar = (col, id, patch) => updateDoc(ref(col, id), patch).catch(falha);
const apagar = (col, id) => deleteDoc(ref(col, id)).catch(falha);
const gravarConfig = patch => setDoc(doc(db, "users", uid(), "config", "geral"), patch, { merge: true }).catch(falha);
async function gravarEmLote(ops) {
  // ops: [{tipo:'set'|'del', col, id, dados}]
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(o => o.tipo === "del" ? b.delete(ref(o.col, o.id)) : b.set(ref(o.col, o.id), o.dados));
    await b.commit();
  }
}

/* ================= cálculos ================= */
const P = id => state.pacientes.find(p => p.id === id) || { nome: "Paciente excluída", valor: 0 };
const S = id => state.sessoes.find(s => s.id === id);
const conta = s => s.status === "realizada" || (s.status === "falta" && s.cobrada);
const ocupaSala = s => s.local === "clinica" && s.status !== "cancelada";
const jaPassou = s => s.data < hojeIso() || (s.data === hojeIso() && s.hora < agoraHM());
const doMes = (y, m) => state.sessoes.filter(s => { const d = parse(s.data); return d.getFullYear() === y && d.getMonth() === m; });
function resumoMes(y, m) {
  const ss = doMes(y, m);
  const previsto = ss.filter(conta).reduce((a, s) => a + (s.valor || 0), 0);
  const recebido = ss.filter(s => conta(s) && s.pago).reduce((a, s) => a + (s.valor || 0), 0);
  const horas = ss.filter(ocupaSala).length;
  const sala = horas * (state.config.valorHoraSala || 0);
  const despesas = (state.config.despesas || []).reduce((a, d) => a + (Number(d.valor) || 0), 0);
  const agendadas = ss.filter(s => s.status === "agendada").reduce((a, s) => a + (s.valor || 0), 0);
  return { ss, previsto, recebido, aReceber: previsto - recebido, horas, sala, despesas, agendadas, resultado: recebido - sala - despesas };
}
const recibosPend = () => state.sessoes.filter(s => conta(s) && s.pago && !s.recibo);
const evoPend = () => state.sessoes.filter(s => s.status === "realizada" && !(s.evolucao || "").trim());
const pagPend = () => state.sessoes.filter(s => conta(s) && !s.pago);
const semSituacao = () => state.sessoes.filter(s => s.status === "agendada" && jaPassou(s));
const diasSemBackup = () => state.config.ultimoBackup ? Math.floor((hoje() - parse(state.config.ultimoBackup)) / 864e5) : null;
const statusPill = s => ({ realizada: '<span class="pill ok">realizada</span>', agendada: jaPassou(s) ? '<span class="pill warn">confirmar</span>' : '<span class="pill">agendada</span>', falta: `<span class="pill bad">falta${s.cobrada ? " cobrada" : ""}</span>`, cancelada: '<span class="pill warn">cancelada</span>' }[s.status]);
const pacPill = st => ({ atendimento: '<span class="pill ok">em atendimento</span>', pausa: '<span class="pill warn">pausa</span>', espera: '<span class="pill">lista de espera</span>', alta: '<span class="pill">alta</span>' }[st] || "");
const localTxt = l => l === "clinica" ? "presencial na clínica" : "online";
const iniciais = nome => (nome || "").split(/\s+/).filter(Boolean).map(p => p[0]).filter((c, i, a) => i === 0 || i === a.length - 1).join("").toUpperCase() || "Ψ";
const ordenar = () => {
  state.sessoes.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  state.pacientes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  state.supervisoes.sort((a, b) => a.data.localeCompare(b.data));
};

/* ================= telas ================= */
const V = {};

function avisosTopo() {
  const d = diasSemBackup();
  const temDados = state.pacientes.some(p => !p.exemplo);
  if (temDados && (d === null || d >= 7))
    return `<div class="banner"><span>${d === null ? "Você ainda não baixou nenhuma cópia dos seus dados." : `A última cópia dos seus dados foi baixada há ${d} dias.`} Uma cópia por semana guardada no seu computador protege o seu trabalho.</span><button class="btn sm" onclick="exportarJSON()">Baixar cópia agora</button></div>`;
  return "";
}

V.painel = () => {
  const t = hoje(), ti = hojeIso();
  if (!state.pacientes.length) return `
    <div class="head"><h1>Boas-vindas${state.config.nome ? ", " + esc(state.config.nome.split(" ")[0]) : ""}<em>vamos começar o seu consultório</em></h1></div>
    <div class="welcome"><h2>Primeiros passos</h2>
      <p>Comece preenchendo o seu nome, o CRP e a cidade, que aparecem no topo e nos documentos. Depois cadastre as suas pacientes com o horário fixo de cada uma e o sistema monta a agenda das próximas semanas. Se preferir conhecer o sistema antes, carregue os dados de exemplo; eles aparecem marcados e podem ser apagados de uma vez em Configurações.</p>
      <div class="row"><button class="btn" onclick="location.hash='configuracoes'">Preencher meus dados</button><button class="btn ghost" onclick="formPaciente()">Cadastrar a primeira paciente</button><button class="btn ghost" onclick="carregarExemplos()">Carregar dados de exemplo</button></div></div>`;
  const r = resumoMes(t.getFullYear(), t.getMonth());
  const hj = state.sessoes.filter(s => s.data === ti);
  const semIni = inicioSemana(t), semFim = addDays(semIni, 6);
  const sem = state.sessoes.filter(s => s.data >= iso(semIni) && s.data <= iso(semFim) && s.status !== "cancelada");
  const espera = state.pacientes.filter(p => p.status === "espera").length;
  const rp = recibosPend(), ep = evoPend(), pp = pagPend(), ss = semSituacao();
  const proxSup = state.supervisoes.find(s => s.data >= ti);
  const saud = new Date().getHours() < 12 ? "Bom dia" : new Date().getHours() < 18 ? "Boa tarde" : "Boa noite";
  return `${avisosTopo()}
  <div class="head"><h1>${saud}${state.config.nome ? ", " + esc(state.config.nome.split(" ")[0]) : ""}<em>${DIAS[t.getDay()]}, ${fmtLong(ti)}</em></h1>
    <button class="btn" onclick="formSessao()">Agendar sessão</button></div>
  <div class="grid cards">
    <div class="card kpi blue"><div class="label">Sessões hoje</div><div class="num">${hj.length}</div><div class="sub">${hj.filter(s => s.local === "clinica").length} na clínica e ${hj.filter(s => s.local === "online").length} online</div></div>
    <div class="card kpi"><div class="label">Sessões nesta semana</div><div class="num">${sem.length}</div><div class="sub">${sem.filter(s => s.status === "realizada").length} já realizadas</div></div>
    <div class="card kpi"><div class="label">Recebido em ${MESES[t.getMonth()]}</div><div class="num">${brl(r.recebido)}</div><div class="sub">${brl(r.aReceber)} a receber</div></div>
    <div class="card kpi"><div class="label">Recibos a emitir</div><div class="num">${rp.length}</div><div class="sub">no aplicativo Receita Saúde</div></div>
    <div class="card kpi"><div class="label">Evoluções pendentes</div><div class="num">${ep.length}</div><div class="sub">sessões sem registro</div></div>
    <div class="card kpi"><div class="label">Sala em ${MESES[t.getMonth()]}</div><div class="num">${r.horas} h</div><div class="sub">${brl(r.sala)} a pagar à clínica</div></div>
    <div class="card kpi"><div class="label">Lista de espera</div><div class="num">${espera}</div><div class="sub">pessoas aguardando horário</div></div>
  </div>
  <div class="grid two section">
    <div><h2>Hoje</h2><div class="list" style="margin-top:12px">${hj.length ? hj.map(s => `
      <div class="item" onclick="abrirSessao('${s.id}')"><div><div class="t">${s.hora} ${esc(P(s.pid).nome)}</div><div class="s">${localTxt(s.local)}</div></div>${statusPill(s)}</div>`).join("") : '<p class="muted">Nenhuma sessão hoje.</p>'}</div></div>
    <div><h2>Pendências</h2><div class="list" style="margin-top:12px">
      ${ss.slice(-4).map(s => `<div class="item" onclick="abrirSessao('${s.id}')"><div><div class="t">Confirmar se a sessão aconteceu</div><div class="s">${esc(P(s.pid).nome)}, ${fmt(s.data)}, ${s.hora}</div></div><span class="pill warn">agenda</span></div>`).join("")}
      ${ep.slice(-4).map(s => `<div class="item" onclick="abrirSessao('${s.id}')"><div><div class="t">Registrar evolução</div><div class="s">${esc(P(s.pid).nome)}, sessão de ${fmt(s.data)}</div></div><span class="pill warn">prontuário</span></div>`).join("")}
      ${rp.slice(0, 3).map(s => `<div class="item" onclick="abrirSessao('${s.id}')"><div><div class="t">Emitir recibo</div><div class="s">${esc(P(s.pid).nome)}, ${fmt(s.data)}, ${brl(s.valor)}</div></div><span class="pill warn">Receita Saúde</span></div>`).join("")}
      ${pp.slice(0, 3).map(s => `<div class="item" onclick="abrirSessao('${s.id}')"><div><div class="t">Pagamento em aberto</div><div class="s">${esc(P(s.pid).nome)}, ${fmt(s.data)}, ${brl(s.valor)}</div></div><span class="pill bad">a receber</span></div>`).join("")}
      ${proxSup ? `<div class="item" onclick="location.hash='carreira'"><div><div class="t">Supervisão</div><div class="s">${DIAS[parse(proxSup.data).getDay()]}, ${fmtLong(proxSup.data)}</div></div><span class="pill">carreira</span></div>` : ""}
      ${!ss.length && !ep.length && !rp.length && !pp.length && !proxSup ? '<p class="muted">Nenhuma pendência. Tudo em dia.</p>' : ""}
    </div></div>
  </div>`;
};

V.agenda = () => {
  const ini = state.semana, dias = [0, 1, 2, 3, 4, 5].map(i => addDays(ini, i)), fimS = dias[5];
  return `
  <div class="head"><h1>Agenda<em>${ini.getDate()} de ${MESES[ini.getMonth()]} a ${fimS.getDate()} de ${MESES[fimS.getMonth()]}</em></h1>
    <div class="row"><button class="btn ghost" onclick="mudaSemana(-7)">Semana anterior</button><button class="btn ghost" onclick="mudaSemana(0)">Hoje</button><button class="btn ghost" onclick="mudaSemana(7)">Próxima semana</button><button class="btn" onclick="formSessao()">Agendar sessão</button></div></div>
  <div class="legend" style="margin-bottom:12px"><span>online</span><span class="c">presencial na clínica (sala paga por hora)</span></div>
  <div class="week">${dias.map(d => {
    const ds = iso(d), ss = state.sessoes.filter(s => s.data === ds), h = ss.filter(ocupaSala).length;
    return `<div class="day ${ds === hojeIso() ? "today" : ""}"><h3>${DIAS[d.getDay()]}</h3><div class="date">${fmt(ds)}${h ? ` · ${h} h de sala` : ""}</div>
      ${ss.map(s => `<div class="slot ${s.local} ${s.status}" onclick="abrirSessao('${s.id}')"><b>${s.hora}</b>${esc(P(s.pid).nome)}</div>`).join("") || '<div class="muted" style="font-size:14px">Livre</div>'}</div>`;
  }).join("")}</div>`;
};

V.pacientes = () => {
  if (state.paciente && state.pacientes.some(p => p.id === state.paciente)) return fichaPaciente(P(state.paciente));
  const filtros = [["atendimento", "Em atendimento"], ["pausa", "Pausa"], ["espera", "Lista de espera"], ["alta", "Alta"], ["todos", "Todos"]];
  let lista = state.pacientes.filter(p => state.filtro === "todos" || p.status === state.filtro);
  if (state.busca) lista = lista.filter(p => p.nome.toLowerCase().includes(state.busca.toLowerCase()));
  return `
  <div class="head"><h1>Pacientes<em>${state.pacientes.filter(p => p.status === "atendimento").length} em atendimento</em></h1><button class="btn" onclick="formPaciente()">Cadastrar paciente</button></div>
  <div class="row" style="justify-content:space-between;margin-bottom:12px">
    <div class="chips">${filtros.map(([k, t]) => `<button class="chip ${state.filtro === k ? "on" : ""}" onclick="setFiltro('${k}')">${t}</button>`).join("")}</div>
    <div style="min-width:220px"><input id="busca" placeholder="Buscar pelo nome" value="${esc(state.busca)}" oninput="buscar(this.value)"></div>
  </div>
  <div class="card tablewrap"><table>
    <thead><tr><th>Paciente</th><th>Formato</th><th>Horário</th><th class="r">Valor</th><th class="r">Em aberto</th><th>Situação</th></tr></thead>
    <tbody>${lista.map(p => {
      const aberto = state.sessoes.filter(s => s.pid === p.id && conta(s) && !s.pago).reduce((a, s) => a + (s.valor || 0), 0);
      return `<tr class="click" onclick="abrirPaciente('${p.id}')"><td><strong>${esc(p.nome)}</strong>${p.idade && p.idade < 18 ? ' <span class="pill warn">menor</span>' : ""}${p.exemplo ? ' <span class="pill">exemplo</span>' : ""}</td><td>${localTxt(p.local)}</td><td>${p.dow !== null && p.dow !== "" && p.dow !== undefined ? `${DIAS[p.dow]}, ${esc(p.hora)}${p.freq === "quinzenal" ? " (quinzenal)" : ""}` : '<span class="muted">a definir</span>'}</td><td class="r">${brl(p.valor)}${p.social ? ' <span class="pill">social</span>' : ""}</td><td class="r">${aberto ? `<span class="pill bad">${brl(aberto)}</span>` : '<span class="muted">nada</span>'}</td><td>${pacPill(p.status)}</td></tr>`;
    }).join("") || '<tr><td colspan="6" class="muted">Nenhum paciente nesta lista.</td></tr>'}</tbody>
  </table></div>`;
};

function fichaPaciente(p) {
  const ss = state.sessoes.filter(s => s.pid === p.id);
  const passadas = ss.filter(s => s.status !== "agendada" || jaPassou(s)).slice().reverse();
  const prox = ss.find(s => s.status === "agendada" && !jaPassou(s));
  const aberto = ss.filter(s => conta(s) && !s.pago);
  const docs = state.documentos.filter(d => d.pid === p.id);
  const temHorario = p.dow !== null && p.dow !== "" && p.dow !== undefined && p.hora;
  return `
  <div class="head"><h1>${esc(p.nome)}<em>${p.idade ? p.idade + " anos · " : ""}${localTxt(p.local)} · ${pacPill(p.status)}</em></h1>
    <div class="row"><button class="btn ghost" onclick="voltarLista()">Voltar à lista</button><button class="btn ghost" onclick="formPaciente('${p.id}')">Editar cadastro</button>${temHorario && p.status === "atendimento" ? `<button class="btn ghost" onclick="formGerar('${p.id}')">Gerar sessões</button>` : ""}<button class="btn" onclick="formDeclaracao('${p.id}')">Declaração de comparecimento</button></div></div>
  <div class="grid two">
    <div class="card"><h2>Cadastro</h2><table style="margin-top:8px">
      <tr><th>CPF</th><td>${esc(p.cpf) || '<span class="pill warn">falta o CPF, obrigatório no recibo</span>'}</td></tr>
      <tr><th>Horário fixo</th><td>${temHorario ? `${DIAS[p.dow]}, ${esc(p.hora)}, ${p.freq}` : "a definir"}</td></tr>
      <tr><th>Valor da sessão</th><td>${brl(p.valor)}${p.social ? " (valor social)" : ""}</td></tr>
      <tr><th>Início</th><td>${p.inicio ? fmtLong(p.inicio) : "ainda não começou"}</td></tr>
      <tr><th>Origem</th><td>${esc(p.origem) || '<span class="muted">não informada</span>'}</td></tr>
      <tr><th>Contato de emergência</th><td>${esc(p.emergencia) || '<span class="muted">não informado</span>'}</td></tr>
      ${p.responsavel ? `<tr><th>Responsável legal</th><td>${esc(p.responsavel)}</td></tr>` : ""}
      <tr><th>Próxima sessão</th><td>${prox ? `${DIAS[parse(prox.data).getDay()]}, ${fmt(prox.data)}, ${prox.hora}` : "nenhuma agendada"}</td></tr>
    </table></div>
    <div class="card"><h2>Financeiro da paciente</h2>
      <div class="grid cards" style="margin-top:10px">
        <div class="kpi"><div class="label">Em aberto</div><div class="num">${brl(aberto.reduce((a, s) => a + (s.valor || 0), 0))}</div><div class="sub">${aberto.length} sessões</div></div>
        <div class="kpi"><div class="label">Recibos a emitir</div><div class="num">${ss.filter(s => conta(s) && s.pago && !s.recibo).length}</div><div class="sub">Receita Saúde</div></div>
      </div>
      <h3 style="margin-top:14px">Documentos emitidos</h3>
      ${docs.length ? `<table>${docs.map(d => `<tr><td>${esc(d.tipo)}</td><td class="r">${fmt(d.data)}</td></tr>`).join("")}</table>` : '<p class="muted">Nenhum documento emitido.</p>'}
    </div>
  </div>
  <div class="section card">
    <h2>Registro documental<em>a paciente ou o responsável legal tem acesso integral a este conteúdo</em></h2>
    <div class="grid two" style="margin-top:14px">
      <div><label>Avaliação da demanda</label><p style="margin:0;white-space:pre-wrap">${esc(p.demanda) || '<span class="muted">a preencher em Editar cadastro</span>'}</p></div>
      <div><label>Objetivos do trabalho</label><p style="margin:0;white-space:pre-wrap">${esc(p.objetivos) || '<span class="muted">a preencher em Editar cadastro</span>'}</p></div>
    </div>
    <h3 style="margin:18px 0 10px">Evolução</h3>
    ${passadas.length ? passadas.map(s => `<div class="evo ${s.status === "realizada" && !s.evolucao ? "pend" : ""}"><div class="d">${fmtLong(s.data)}, ${s.hora} · ${statusPill(s)}</div>
      ${s.status === "realizada" ? (s.evolucao ? `<div style="white-space:pre-wrap">${esc(s.evolucao)}</div>` : `<div class="row" style="margin-top:4px"><span class="muted">Evolução ainda não registrada.</span><button class="btn sm" onclick="abrirSessao('${s.id}')">Registrar agora</button></div>`) : s.status === "agendada" ? `<div class="row" style="margin-top:4px"><span class="muted">Falta confirmar se a sessão aconteceu.</span><button class="btn sm ghost" onclick="abrirSessao('${s.id}')">Confirmar</button></div>` : '<div class="muted">Sessão não realizada.</div>'}</div>`).join("") : '<p class="muted">Nenhuma sessão realizada.</p>'}
    ${p.encerramento ? `<h3 style="margin:14px 0 6px">Encaminhamento ou encerramento</h3><p style="margin:0;white-space:pre-wrap">${esc(p.encerramento)}</p>` : ""}
  </div>
  <div class="section lock"><strong>Instrumentos de avaliação psicológica.</strong> Os testes aplicados ficam fora do sistema, em pasta de acesso exclusivo da psicóloga, como pede a Resolução CFP 01/2009.</div>
  <div class="section"><button class="x" onclick="excluirPaciente('${p.id}')">Excluir esta paciente e todas as sessões dela</button></div>`;
}

V.financeiro = () => {
  const { y, m } = state.mes, r = resumoMes(y, m);
  const linhas = r.ss.filter(s => conta(s) || s.status === "agendada");
  return `
  <div class="head"><h1>Financeiro<em>${MESES[m]} de ${y}</em></h1>
    <div class="row"><button class="btn ghost" onclick="mudaMes(-1)">Mês anterior</button><button class="btn ghost" onclick="mudaMes(1)">Próximo mês</button></div></div>
  <div class="grid cards">
    <div class="card kpi blue"><div class="label">Recebido</div><div class="num">${brl(r.recebido)}</div><div class="sub">entra no Carnê-Leão pelo recibo</div></div>
    <div class="card kpi"><div class="label">A receber</div><div class="num">${brl(r.aReceber)}</div><div class="sub">sessões feitas e não pagas</div></div>
    <div class="card kpi"><div class="label">Ainda agendado</div><div class="num">${brl(r.agendadas)}</div><div class="sub">sessões a confirmar ou futuras</div></div>
    <div class="card kpi"><div class="label">Recibos a emitir</div><div class="num">${r.ss.filter(s => conta(s) && s.pago && !s.recibo).length}</div><div class="sub">Receita Saúde</div></div>
  </div>
  <div class="grid two section">
    <div class="card"><h2>Resultado do mês</h2><table style="margin-top:8px">
      <thead><tr><th>Conta</th><th class="r">Valor</th></tr></thead>
      <tbody>
        <tr><td>Recebido das pacientes</td><td class="r">${brl(r.recebido)}</td></tr>
        <tr><td>Sala da clínica (${r.horas} h × ${brl(state.config.valorHoraSala)})</td><td class="r">− ${brl(r.sala)}</td></tr>
        ${(state.config.despesas || []).map(d => `<tr><td>${esc(d.item)}</td><td class="r">− ${brl(d.valor)}</td></tr>`).join("")}
      </tbody>
      <tfoot><tr><td>Sobra antes do imposto</td><td class="r">${brl(r.resultado)}</td></tr></tfoot>
    </table><p class="note">O imposto do Carnê-Leão e o INSS de autônoma não estão nesta conta. As despesas fixas são editadas em Configurações.</p></div>
    <div class="card"><h2>Receita Saúde</h2>
      <p>Como pessoa física, cada pagamento recebido precisa de recibo emitido no aplicativo Receita Saúde, com o CPF da paciente e o número do CRP. O recibo entra no Carnê-Leão e na declaração da paciente.</p>
      <p class="note">O sistema não emite o recibo. Ele mostra o que falta emitir e guarda a marcação de que já foi feito.</p>
      <div class="list" style="margin-top:10px">${recibosPend().slice(0, 8).map(s => `<div class="item" onclick="abrirSessao('${s.id}')"><div><div class="t">${esc(P(s.pid).nome)}</div><div class="s">${fmt(s.data)}, ${brl(s.valor)}</div></div><button class="btn sm" onclick="event.stopPropagation();marcarRecibo('${s.id}')">Marcar como emitido</button></div>`).join("") || '<p class="muted">Todos os recibos estão em dia.</p>'}</div>
    </div>
  </div>
  <div class="section card tablewrap"><h2>Sessões do mês</h2><table style="margin-top:8px">
    <thead><tr><th>Data</th><th>Paciente</th><th>Formato</th><th>Situação</th><th class="r">Valor</th><th>Pagamento</th><th>Recibo</th></tr></thead>
    <tbody>${linhas.map(s => `<tr class="click" onclick="abrirSessao('${s.id}')"><td>${fmt(s.data)} ${s.hora}</td><td>${esc(P(s.pid).nome)}</td><td>${localTxt(s.local)}</td><td>${statusPill(s)}</td><td class="r">${brl(s.valor)}</td><td>${s.status === "agendada" ? '<span class="muted">ainda não</span>' : s.pago ? '<span class="pill ok">pago</span>' : '<span class="pill bad">em aberto</span>'}</td><td>${!conta(s) || !s.pago ? '<span class="muted">sem pagamento</span>' : s.recibo ? '<span class="pill ok">emitido</span>' : '<span class="pill warn">a emitir</span>'}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Nenhuma sessão neste mês.</td></tr>'}</tbody>
  </table></div>`;
};

V.clinica = () => {
  const { y, m } = state.mes, r = resumoMes(y, m), porDia = {};
  r.ss.filter(ocupaSala).forEach(s => { (porDia[s.data] ??= []).push(s); });
  const dias = Object.keys(porDia).sort(), vh = state.config.valorHoraSala || 0;
  return `
  <div class="head"><h1>Sala da clínica<em>horas usadas em ${MESES[m]} de ${y}</em></h1>
    <div class="row"><button class="btn ghost" onclick="mudaMes(-1)">Mês anterior</button><button class="btn ghost" onclick="mudaMes(1)">Próximo mês</button></div></div>
  <div class="grid cards">
    <div class="card kpi blue"><div class="label">Horas de sala</div><div class="num">${r.horas} h</div><div class="sub">${dias.length} dias na clínica</div></div>
    <div class="card kpi"><div class="label">Valor da hora</div><div class="num">${brl(vh)}</div><div class="sub"><label for="vh" style="display:inline;color:inherit">Alterar:</label> <input id="vh" type="number" min="0" step="1" value="${vh}" style="width:90px;padding:3px 6px" onchange="salvarValorHora(this.value)"></div></div>
    <div class="card kpi"><div class="label">A pagar à clínica</div><div class="num">${brl(r.sala)}</div><div class="sub">horas × valor da hora</div></div>
    <div class="card kpi"><div class="label">Receita presencial</div><div class="num">${brl(r.ss.filter(s => s.local === "clinica" && conta(s)).reduce((a, s) => a + (s.valor || 0), 0))}</div><div class="sub">sessões feitas na clínica</div></div>
  </div>
  <div class="section card tablewrap"><h2>Conferência com a cobrança da clínica</h2><table style="margin-top:8px">
    <thead><tr><th>Dia</th><th>Sessões</th><th class="r">Horas</th><th class="r">Valor da hora</th><th class="r">Total do dia</th></tr></thead>
    <tbody>${dias.map(d => `<tr><td>${DIAS[parse(d).getDay()]}, ${fmt(d)}</td><td>${porDia[d].map(s => `${s.hora} ${esc(P(s.pid).nome.split(" ")[0])}${s.status === "falta" ? " (falta)" : ""}${s.status === "agendada" ? " (agendada)" : ""}`).join(", ")}</td><td class="r">${porDia[d].length}</td><td class="r">${brl(vh)}</td><td class="r">${brl(porDia[d].length * vh)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Nenhuma sessão presencial neste mês.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">Total do mês</td><td class="r">${r.horas}</td><td></td><td class="r">${brl(r.sala)}</td></tr></tfoot>
  </table><p class="note">Cada sessão presencial ocupa 1 hora de sala. A falta da paciente continua contando, porque a sala ficou reservada; a sessão cancelada sai da conta.</p></div>`;
};

V.documentos = () => {
  const modelos = [
    ["Contrato terapêutico", "valor, frequência, faltas, férias e reajuste"],
    ["Termo de consentimento, atendimento online", "plataforma, sigilo e conexão"],
    ["Termo de consentimento, atendimento presencial", "endereço da clínica e regras da sala"],
    ["Autorização do responsável legal", "para pacientes menores de 18 anos"],
    ["Declaração de comparecimento", "data e horário da sessão"],
    ["Atestado psicológico", "Resolução CFP 06/2019"],
    ["Relatório psicológico", "Resolução CFP 06/2019"],
    ["Laudo psicológico", "Resolução CFP 06/2019"],
    ["Parecer psicológico", "Resolução CFP 06/2019"]
  ];
  return `
  <div class="head"><h1>Documentos<em>modelos e histórico do que foi emitido</em></h1></div>
  <div class="grid cards">${modelos.map(([t, s]) => `<div class="card"><h3>${t}</h3><p class="muted" style="margin:6px 0 12px;font-size:14px">${s}</p>${t === "Declaração de comparecimento" ? '<button class="btn sm" onclick="formDeclaracao()">Gerar agora</button>' : `<button class="btn sm ghost" onclick="registrarDocManual('${t}')">Registrar emissão</button>`}</div>`).join("")}</div>
  <p class="note">Os outros modelos entram nas próximas versões. Por enquanto, quando emitir um deles fora do sistema, registre a emissão para manter o histórico.</p>
  <div class="section card tablewrap"><h2>Emitidos</h2><table style="margin-top:8px">
    <thead><tr><th>Data</th><th>Documento</th><th>Paciente</th><th></th></tr></thead>
    <tbody>${state.documentos.slice().sort((a, b) => b.data.localeCompare(a.data)).map(d => `<tr><td>${fmt(d.data)}</td><td>${esc(d.tipo)}</td><td>${esc(P(d.pid).nome)}</td><td class="r"><button class="x" onclick="apagarItem('documentos','${d.id}')">excluir</button></td></tr>`).join("") || '<tr><td colspan="4" class="muted">Nenhum documento emitido.</td></tr>'}</tbody></table></div>`;
};

V.carreira = () => {
  const ti = hojeIso(), prox = state.supervisoes.find(s => s.data >= ti);
  const horas = state.formacoes.filter(f => f.situacao === "concluído").reduce((a, f) => a + (Number(f.horas) || 0), 0);
  return `
  <div class="head"><h1>Carreira<em>registro, supervisão, formação e guarda dos prontuários</em></h1></div>
  <div class="grid cards">
    <div class="card kpi blue"><div class="label">Registro</div><div class="num">${esc(state.config.crp) || "CRP"}</div><div class="sub">${state.config.crp ? "número informado em Configurações" : "informe o número em Configurações"}</div></div>
    <div class="card kpi"><div class="label">Próxima supervisão</div><div class="num">${prox ? fmt(prox.data) : "sem data"}</div><div class="sub">${prox ? DIAS[parse(prox.data).getDay()] : "cadastre abaixo"}</div></div>
    <div class="card kpi"><div class="label">Horas de formação</div><div class="num">${horas} h</div><div class="sub">cursos concluídos</div></div>
  </div>
  <div class="grid two section">
    <div class="card tablewrap"><h2>Supervisão</h2><table style="margin-top:8px"><thead><tr><th>Data</th><th>Caso ou tema</th><th></th></tr></thead>
      <tbody>${state.supervisoes.map(s => `<tr><td>${fmt(s.data)}</td><td>${esc(s.tema)}</td><td class="r"><button class="x" onclick="apagarItem('supervisoes','${s.id}')">excluir</button></td></tr>`).join("") || '<tr><td colspan="3" class="muted">Nenhuma supervisão cadastrada.</td></tr>'}</tbody></table>
      <form class="form" style="margin-top:12px" onsubmit="event.preventDefault();novaSupervisao()">
        <div><label for="sv-d">Data</label><input id="sv-d" type="date" required></div>
        <div><label for="sv-t">Caso ou tema</label><input id="sv-t" placeholder="Use só as iniciais"></div>
        <div class="full"><button class="btn sm" type="submit">Adicionar supervisão</button></div></form></div>
    <div class="card tablewrap"><h2>Formação</h2><table style="margin-top:8px"><thead><tr><th>Curso</th><th class="r">Horas</th><th>Situação</th><th></th></tr></thead>
      <tbody>${state.formacoes.map(f => `<tr><td>${esc(f.curso)}</td><td class="r">${f.horas}</td><td>${f.situacao === "concluído" ? '<span class="pill ok">concluído</span>' : '<span class="pill">em andamento</span>'}</td><td class="r"><button class="x" onclick="apagarItem('formacoes','${f.id}')">excluir</button></td></tr>`).join("") || '<tr><td colspan="4" class="muted">Nenhum curso cadastrado.</td></tr>'}</tbody></table>
      <form class="form" style="margin-top:12px" onsubmit="event.preventDefault();novaFormacao()">
        <div class="full"><label for="fo-c">Curso</label><input id="fo-c" required></div>
        <div><label for="fo-h">Horas</label><input id="fo-h" type="number" min="0"></div>
        <div><label for="fo-s">Situação</label><select id="fo-s"><option value="em andamento">em andamento</option><option value="concluído">concluído</option></select></div>
        <div class="full"><button class="btn sm" type="submit">Adicionar curso</button></div></form></div>
  </div>
  <div class="section lock"><strong>Guarda dos prontuários.</strong> A Resolução CFP 01/2009 fala em no mínimo 5 anos, e há orientação de conselho regional para 20 anos a partir do último registro, com base na Lei 13.787/2018. Confirme o prazo com o seu CRP e guarde as cópias baixadas pelo mesmo período.</div>`;
};

V.configuracoes = () => {
  const c = state.config, d = diasSemBackup();
  const nEx = state.pacientes.filter(p => p.exemplo).length;
  return `
  <div class="head"><h1>Configurações<em>seus dados, despesas fixas e cópias de segurança</em></h1></div>
  <div class="grid two">
    <div class="card"><h2>Seus dados</h2>
      <form class="form" style="margin-top:10px" onsubmit="event.preventDefault();salvarPerfil()">
        <div class="full"><label for="cf-n">Nome profissional</label><input id="cf-n" value="${esc(c.nome)}"></div>
        <div><label for="cf-c">CRP</label><input id="cf-c" value="${esc(c.crp)}" placeholder="05/00000"></div>
        <div><label for="cf-ci">Cidade dos documentos</label><input id="cf-ci" value="${esc(c.cidade)}"></div>
        <div><label for="cf-v">Valor da hora da sala</label><input id="cf-v" type="number" min="0" value="${c.valorHoraSala}"></div>
        <div class="full"><button class="btn" type="submit">Salvar</button></div></form></div>
    <div class="card"><h2>Despesas fixas do mês</h2>
      <table style="margin-top:8px"><tbody>${(c.despesas || []).map((x, i) => `<tr><td>${esc(x.item)}</td><td class="r">${brl(x.valor)}</td><td class="r"><button class="x" onclick="removerDespesa(${i})">excluir</button></td></tr>`).join("") || '<tr><td class="muted">Nenhuma despesa cadastrada.</td></tr>'}</tbody></table>
      <form class="form" style="margin-top:12px" onsubmit="event.preventDefault();novaDespesa()">
        <div><label for="dp-i">Despesa</label><input id="dp-i" required placeholder="Supervisão, plataforma de vídeo"></div>
        <div><label for="dp-v">Valor mensal</label><input id="dp-v" type="number" min="0" step="0.01" required></div>
        <div class="full"><button class="btn sm" type="submit">Adicionar despesa</button></div></form></div>
  </div>
  <div class="section card"><h2>Cópia de segurança e exportação</h2>
    <p>${d === null ? "Nenhuma cópia baixada até agora." : `Última cópia baixada em ${fmtLong(c.ultimoBackup)}, há ${d} dias.`} O arquivo completo serve para restaurar tudo no sistema; as planilhas abrem no Excel e no Google Planilhas.</p>
    <div class="row"><button class="btn" onclick="exportarJSON()">Baixar cópia completa</button><button class="btn ghost" onclick="exportarCSV('pacientes')">Planilha de pacientes</button><button class="btn ghost" onclick="exportarCSV('sessoes')">Planilha de sessões e prontuário</button><button class="btn ghost" onclick="$('imp').click()">Restaurar a partir de uma cópia</button><input id="imp" type="file" accept="application/json,.json" style="display:none" onchange="importarJSON(this.files[0]);this.value=''"></div>
    <p class="note">Os arquivos contêm dados de saúde das pacientes. Guarde em local protegido por senha e não envie por e-mail nem por WhatsApp.</p></div>
  <div class="grid two section">
    <div class="card"><h2>Dados de exemplo</h2><p>${nEx ? `Há ${nEx} pacientes de exemplo no sistema, com as sessões delas.` : "Nenhum dado de exemplo no sistema."}</p>
      <div class="row">${nEx ? '<button class="btn danger" onclick="apagarExemplos()">Apagar dados de exemplo</button>' : '<button class="btn ghost" onclick="carregarExemplos()">Carregar dados de exemplo</button>'}</div></div>
    <div class="card"><h2>Conta</h2><p>Conectada como <strong>${esc(state.user?.email)}</strong>.</p><div class="row"><button class="btn ghost" onclick="trocarSenha()">Receber e-mail para trocar a senha</button><button class="btn ghost" onclick="sair()">Sair</button></div></div>
  </div>`;
};

V.login = () => state.modoLogin === "criar" ? `
  <div class="login-wrap"><div class="card">
    <h1>Criar conta<em>escolha o e-mail e a senha que vai usar</em></h1>
    <form class="stack" style="margin-top:16px" onsubmit="event.preventDefault();criarConta()">
      <div><label for="cc-n">Nome profissional</label><input id="cc-n" autocomplete="name" required></div>
      <div><label for="cc-e">E-mail</label><input id="cc-e" type="email" autocomplete="username" required></div>
      <div><label for="cc-s">Senha, com pelo menos 8 caracteres</label><input id="cc-s" type="password" autocomplete="new-password" minlength="8" required></div>
      <div><label for="cc-s2">Repita a senha</label><input id="cc-s2" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="err" id="cc-err"></div>
      <button class="btn" type="submit" id="cc-b">Criar conta</button>
      <button class="link" type="button" onclick="modoLogin('entrar')">Já tenho conta</button>
    </form>
    <p class="note">Os dados que você cadastrar ficam visíveis só para a sua conta.</p>
  </div></div>` : `
  <div class="login-wrap"><div class="card">
    <h1>Consultório<em>entre com o seu e-mail e senha</em></h1>
    <form class="stack" style="margin-top:16px" onsubmit="event.preventDefault();entrar()">
      <div><label for="lg-e">E-mail</label><input id="lg-e" type="email" autocomplete="username" required></div>
      <div><label for="lg-s">Senha</label><input id="lg-s" type="password" autocomplete="current-password" required></div>
      <div class="err" id="lg-err"></div>
      <button class="btn" type="submit" id="lg-b">Entrar</button>
      <div class="row" style="justify-content:space-between"><button class="link" type="button" onclick="esqueci()">Esqueci a senha</button><button class="link" type="button" onclick="modoLogin('criar')">Criar conta</button></div>
    </form>
  </div></div>`;

/* ================= render ================= */
const ROTAS = ["painel", "agenda", "pacientes", "financeiro", "clinica", "documentos", "carreira", "configuracoes"];
function render() {
  const app = $("app"), tabs = $("tabs");
  if (!state.user) { tabs.style.display = "none"; $("marca").style.visibility = "hidden"; app.innerHTML = V.login(); return; }
  tabs.style.display = ""; $("marca").style.visibility = "";
  $("mono").textContent = iniciais(state.config.nome);
  $("nomeTopo").textContent = state.config.nome || "Consultório";
  $("crpTopo").textContent = state.config.crp ? `psicóloga, CRP ${state.config.crp}` : "psicóloga";
  if (state.carregado.size < COLECOES.length + 1) { app.innerHTML = '<div class="loading">Carregando seus dados…</div>'; return; }
  const h = (location.hash || "#painel").slice(1), rota = ROTAS.includes(h) ? h : "painel";
  tabs.querySelectorAll("a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + rota));
  const foco = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  app.innerHTML = V[rota]();
  if (foco === "busca" && $("busca")) { $("busca").focus(); try { $("busca").setSelectionRange(pos, pos); } catch (e) {} }
}
window.addEventListener("hashchange", () => { if ((location.hash || "").slice(1) !== "pacientes") state.paciente = null; render(); window.scrollTo(0, 0); });
window.addEventListener("online", () => $("offline").style.display = "none");
window.addEventListener("offline", () => $("offline").style.display = "block");

/* ================= autenticação e escuta ================= */
onAuthStateChanged(auth, user => {
  desligar.forEach(f => f()); desligar = [];
  state.user = user; state.carregado = new Set();
  COLECOES.forEach(c => state[c] = []); state.config = { ...CONFIG_PADRAO };
  if (user) {
    COLECOES.forEach(c => desligar.push(onSnapshot(collection(db, "users", user.uid, c), snap => {
      state[c] = snap.docs.map(d => ({ id: d.id, ...d.data() })); ordenar(); state.carregado.add(c); render();
    }, e => { console.error(e); toast("Não foi possível ler os dados. Confira a conexão."); })));
    desligar.push(onSnapshot(doc(db, "users", user.uid, "config", "geral"), d => {
      state.config = { ...CONFIG_PADRAO, ...(d.data() || {}) }; state.carregado.add("config");
      if (!d.exists() && state.nomeCadastro) { gravarConfig({ nome: state.nomeCadastro, email: user.email, criadoEm: serverTimestamp() }); state.nomeCadastro = ""; }
      render();
    }));
  }
  render();
});
async function entrar() {
  $("lg-b").disabled = true; $("lg-err").textContent = "";
  try { await signInWithEmailAndPassword(auth, val("lg-e"), $("lg-s").value); }
  catch (e) { $("lg-err").textContent = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(e.code) ? "E-mail ou senha incorretos." : e.code === "auth/too-many-requests" ? "Muitas tentativas. Espere alguns minutos e tente de novo." : "Não foi possível entrar. Confira a conexão."; $("lg-b").disabled = false; }
}
function modoLogin(m) { state.modoLogin = m; render(); }
async function criarConta() {
  const err = $("cc-err"); err.textContent = "";
  if ($("cc-s").value !== $("cc-s2").value) { err.textContent = "As 2 senhas não são iguais."; return; }
  $("cc-b").disabled = true;
  state.nomeCadastro = val("cc-n");
  try { await createUserWithEmailAndPassword(auth, val("cc-e"), $("cc-s").value); }
  catch (e) {
    state.nomeCadastro = "";
    err.textContent = ({ "auth/email-already-in-use": "Já existe uma conta com este e-mail. Use Já tenho conta para entrar.", "auth/invalid-email": "Este e-mail não é válido.", "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres.", "auth/password-does-not-meet-requirements": "A senha precisa ter pelo menos 8 caracteres.", "auth/operation-not-allowed": "O cadastro está desativado no momento." })[e.code] || "Não foi possível criar a conta. Confira a conexão.";
    $("cc-b").disabled = false;
  }
}
async function esqueci() {
  const e = val("lg-e"); if (!e) { $("lg-err").textContent = "Escreva o seu e-mail no campo acima e clique de novo."; return; }
  try { await sendPasswordResetEmail(auth, e); $("lg-err").textContent = ""; toast("Se o e-mail estiver cadastrado, a mensagem para trocar a senha chega em alguns minutos."); }
  catch (er) { $("lg-err").textContent = "Não foi possível enviar o e-mail. Confira o endereço."; }
}
async function trocarSenha() { try { await sendPasswordResetEmail(auth, state.user.email); toast("Enviamos o e-mail para trocar a senha."); } catch (e) { toast("Não foi possível enviar o e-mail."); } }
function sair() { confirmar("Sair do sistema neste aparelho?", "Sair", () => signOut(auth)); }

/* ================= navegação ================= */
function mudaSemana(n) { state.semana = n === 0 ? inicioSemana(hoje()) : addDays(state.semana, n); render(); }
function mudaMes(n) { let { y, m } = state.mes; m += n; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } state.mes = { y, m }; render(); }
function setFiltro(k) { state.filtro = k; render(); }
function buscar(v) { state.busca = v; render(); }
function abrirPaciente(id) { state.paciente = id; render(); window.scrollTo(0, 0); }
function voltarLista() { state.paciente = null; render(); }

/* ================= modal e avisos ================= */
function toast(t) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = "none", 3200); }
const bg = $("modalBg"), md = $("modal");
function abrir(html) { md.innerHTML = html; bg.classList.add("open"); const f = md.querySelector("textarea,input:not([type=checkbox]),select"); if (f) f.focus(); }
function fechar() { bg.classList.remove("open"); }
bg.addEventListener("click", e => { if (e.target === bg) fechar(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") fechar(); });
function confirmar(texto, botao, fn, perigo = false) {
  abrir(`<div class="head"><h2>Confirmar</h2></div><p>${texto}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="fechar()">Voltar</button><button class="btn ${perigo ? "danger" : ""}" id="cf-ok">${botao}</button></div>`);
  $("cf-ok").onclick = () => { fechar(); fn(); };
}

/* ================= sessões ================= */
function abrirSessao(id) {
  const s = S(id); if (!s) return fechar(); const p = P(s.pid);
  abrir(`<div class="head"><h2>${esc(p.nome)}<em>${DIAS[parse(s.data).getDay()]}, ${fmtLong(s.data)}, ${s.hora} · ${localTxt(s.local)}</em></h2><button class="btn ghost sm" onclick="fechar()">Fechar</button></div>
    <label>Situação da sessão</label>
    <div class="chips" style="margin-bottom:12px">${["agendada", "realizada", "falta", "cancelada"].map(st => `<button class="chip ${s.status === st ? "on" : ""}" onclick="setStatus('${id}','${st}')">${st}</button>`).join("")}</div>
    ${s.status === "falta" ? `<label class="check" style="margin-bottom:10px"><input type="checkbox" ${s.cobrada ? "checked" : ""} onchange="setCampo('${id}','cobrada',this.checked)"> Falta cobrada, conforme o contrato</label>` : ""}
    ${conta(s) ? `<div class="row" style="margin-bottom:12px">
      <label class="check"><input type="checkbox" ${s.pago ? "checked" : ""} onchange="setCampo('${id}','pago',this.checked)"> Pagamento recebido (${brl(s.valor)})</label>
      <label class="check"><input type="checkbox" ${s.recibo ? "checked" : ""} ${s.pago ? "" : "disabled"} onchange="setCampo('${id}','recibo',this.checked)"> Recibo emitido no Receita Saúde</label></div>` : ""}
    ${s.status === "realizada" ? `<label for="evo">Evolução da sessão (registro documental)</label><textarea id="evo">${esc(s.evolucao)}</textarea>
      <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn" onclick="salvarEvo('${id}')">Salvar evolução</button></div>` : ""}
    <p class="note">A paciente tem acesso integral ao que for registrado no prontuário.</p>
    <div class="row" style="justify-content:space-between;margin-top:8px"><button class="x" onclick="formSessao('${id}')">Mudar data, horário ou valor</button><button class="x" onclick="excluirSessao('${id}')">Excluir sessão</button></div>`);
}
function setStatus(id, st) {
  const s = S(id), patch = { status: st };
  if (!(st === "realizada" || (st === "falta" && s.cobrada))) { patch.pago = false; patch.recibo = false; }
  Object.assign(s, patch); alterar("sessoes", id, patch); render(); abrirSessao(id);
}
function setCampo(id, k, v) {
  const s = S(id), patch = { [k]: v };
  if (k === "pago" && !v) patch.recibo = false;
  if (k === "cobrada" && !v) { patch.pago = false; patch.recibo = false; }
  Object.assign(s, patch); alterar("sessoes", id, patch); render(); abrirSessao(id);
}
function salvarEvo(id) { const t = $("evo").value; S(id).evolucao = t; alterar("sessoes", id, { evolucao: t }); fechar(); render(); toast("Evolução registrada no prontuário."); }
function marcarRecibo(id) { S(id).recibo = true; alterar("sessoes", id, { recibo: true }); render(); toast("Recibo marcado como emitido."); }
function excluirSessao(id) {
  const s = S(id);
  confirmar(`Excluir a sessão de ${esc(P(s.pid).nome)} do dia ${fmt(s.data)}?${s.evolucao ? " A evolução registrada nela também será apagada." : ""}`, "Excluir", () => { apagar("sessoes", id); toast("Sessão excluída."); }, true);
}
function formSessao(id) {
  const s = id ? S(id) : null;
  const ativos = state.pacientes.filter(p => p.status === "atendimento" || (s && p.id === s.pid));
  if (!ativos.length) { toast("Cadastre uma paciente em atendimento antes de agendar."); return; }
  abrir(`<div class="head"><h2>${s ? "Alterar sessão" : "Agendar sessão"}</h2><button class="btn ghost sm" onclick="fechar()">Fechar</button></div>
  <form class="form" onsubmit="event.preventDefault();salvarSessao('${id || ""}')">
    <div class="full"><label for="ns-p">Paciente</label><select id="ns-p" onchange="$('ns-v').value=(window.__val||{})[this.value]||$('ns-v').value">${ativos.map(p => `<option value="${p.id}" ${s && s.pid === p.id ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select></div>
    <div><label for="ns-d">Data</label><input id="ns-d" type="date" value="${s ? s.data : iso(addDays(hoje(), 1))}" required></div>
    <div><label for="ns-h">Horário</label><input id="ns-h" type="time" value="${s ? s.hora : "10:00"}" required></div>
    <div><label for="ns-l">Formato</label><select id="ns-l"><option value="online" ${s && s.local === "online" ? "selected" : ""}>online</option><option value="clinica" ${s && s.local === "clinica" ? "selected" : ""}>presencial na clínica</option></select></div>
    <div><label for="ns-v">Valor</label><input id="ns-v" type="number" min="0" step="0.01" value="${s ? s.valor : ativos[0].valor}"></div>
    <div class="full" style="display:flex;justify-content:flex-end"><button class="btn" type="submit">${s ? "Salvar" : "Agendar"}</button></div>
  </form>`);
  window.__val = Object.fromEntries(ativos.map(p => [p.id, p.valor]));
}
function salvarSessao(id) {
  const dados = { pid: val("ns-p"), data: val("ns-d"), hora: val("ns-h"), local: val("ns-l"), valor: num("ns-v") };
  if (id) { gravar("sessoes", id, dados); }
  else { const nid = novoId("sessoes"); gravar("sessoes", nid, { ...dados, status: "agendada", cobrada: false, pago: false, recibo: false, evolucao: "", criadoEm: serverTimestamp() }); }
  state.semana = inicioSemana(parse(dados.data)); fechar(); location.hash = "agenda"; render(); toast(id ? "Sessão alterada." : "Sessão agendada.");
}
function formGerar(pid) {
  const p = P(pid);
  abrir(`<div class="head"><h2>Gerar sessões<em>${esc(p.nome)}, ${DIAS[p.dow]}, ${esc(p.hora)}, ${p.freq}</em></h2><button class="btn ghost sm" onclick="fechar()">Fechar</button></div>
  <form class="form" onsubmit="event.preventDefault();gerarSessoes('${pid}')">
    <div><label for="gs-i">A partir de</label><input id="gs-i" type="date" value="${hojeIso()}" required></div>
    <div><label for="gs-n">Quantas semanas</label><input id="gs-n" type="number" min="1" max="52" value="8" required></div>
    <div class="full"><p class="note" style="margin:0">Datas que já têm sessão desta paciente são puladas.</p></div>
    <div class="full" style="display:flex;justify-content:flex-end"><button class="btn" type="submit">Gerar</button></div></form>`);
}
async function gerarSessoes(pid) {
  const p = P(pid), passo = p.freq === "quinzenal" ? 14 : 7, fim = addDays(parse(val("gs-i")), num("gs-n") * 7);
  let d = parse(val("gs-i")); while (d.getDay() !== Number(p.dow)) d = addDays(d, 1);
  const existentes = new Set(state.sessoes.filter(s => s.pid === pid).map(s => s.data));
  const ops = [];
  for (; d < fim; d = addDays(d, passo)) {
    const ds = iso(d); if (existentes.has(ds)) continue;
    ops.push({ tipo: "set", col: "sessoes", id: novoId("sessoes"), dados: { pid, data: ds, hora: p.hora, local: p.local, valor: p.valor, status: "agendada", cobrada: false, pago: false, recibo: false, evolucao: "", criadoEm: serverTimestamp() } });
  }
  fechar();
  try { await gravarEmLote(ops); toast(`${ops.length} sessões criadas na agenda.`); } catch (e) { falha(e); }
}

/* ================= pacientes ================= */
function formPaciente(id) {
  const p = id ? P(id) : { local: "online", freq: "semanal", valor: 220, status: "atendimento", dow: "" };
  const opt = (v, t, atual) => `<option value="${v}" ${String(atual) === String(v) ? "selected" : ""}>${t}</option>`;
  abrir(`<div class="head"><h2>${id ? "Editar cadastro" : "Cadastrar paciente"}</h2><button class="btn ghost sm" onclick="fechar()">Fechar</button></div>
  <form class="form" onsubmit="event.preventDefault();salvarPaciente('${id || ""}')">
    <div class="full"><label for="np-n">Nome completo</label><input id="np-n" required value="${esc(p.nome)}"></div>
    <div><label for="np-i">Idade</label><input id="np-i" type="number" min="1" value="${p.idade ?? ""}"></div>
    <div><label for="np-c">CPF</label><input id="np-c" value="${esc(p.cpf)}" placeholder="000.000.000-00"></div>
    <div><label for="np-s">Situação</label><select id="np-s">${opt("atendimento", "em atendimento", p.status)}${opt("espera", "lista de espera", p.status)}${opt("pausa", "pausa", p.status)}${opt("alta", "alta", p.status)}</select></div>
    <div><label for="np-l">Formato</label><select id="np-l">${opt("online", "online", p.local)}${opt("clinica", "presencial na clínica", p.local)}</select></div>
    <div><label for="np-d">Dia fixo</label><select id="np-d">${opt("", "a definir", p.dow ?? "")}${[1, 2, 3, 4, 5, 6].map(i => opt(i, DIAS[i], p.dow ?? "")).join("")}</select></div>
    <div><label for="np-h">Horário fixo</label><input id="np-h" type="time" value="${esc(p.hora)}"></div>
    <div><label for="np-f">Frequência</label><select id="np-f">${opt("semanal", "semanal", p.freq)}${opt("quinzenal", "quinzenal", p.freq)}</select></div>
    <div><label for="np-v">Valor da sessão</label><input id="np-v" type="number" min="0" step="0.01" value="${p.valor ?? ""}"></div>
    <div><label class="check" style="margin-top:26px"><input type="checkbox" id="np-so" ${p.social ? "checked" : ""}> Valor social</label></div>
    <div><label for="np-in">Início do atendimento</label><input id="np-in" type="date" value="${esc(p.inicio)}"></div>
    <div><label for="np-o">Como chegou</label><input id="np-o" value="${esc(p.origem)}" placeholder="Instagram, indicação"></div>
    <div class="full"><label for="np-e">Contato de emergência</label><input id="np-e" value="${esc(p.emergencia)}"></div>
    <div class="full"><label for="np-r">Responsável legal (menores de 18 anos)</label><input id="np-r" value="${esc(p.responsavel)}" placeholder="Nome, parentesco e data da autorização"></div>
    <div class="full"><label for="np-de">Avaliação da demanda</label><textarea id="np-de">${esc(p.demanda)}</textarea></div>
    <div class="full"><label for="np-ob">Objetivos do trabalho</label><textarea id="np-ob">${esc(p.objetivos)}</textarea></div>
    <div class="full"><label for="np-en">Encaminhamento ou encerramento</label><textarea id="np-en" style="min-height:70px">${esc(p.encerramento)}</textarea></div>
    <div class="full" style="display:flex;justify-content:flex-end"><button class="btn" type="submit">${id ? "Salvar" : "Cadastrar"}</button></div>
  </form>`);
}
function salvarPaciente(id) {
  const dados = {
    nome: val("np-n"), idade: $("np-i").value ? num("np-i") : null, cpf: val("np-c"), status: val("np-s"), local: val("np-l"),
    dow: $("np-d").value === "" ? null : Number($("np-d").value), hora: val("np-h"), freq: val("np-f"), valor: num("np-v"), social: $("np-so").checked,
    inicio: val("np-in"), origem: val("np-o"), emergencia: val("np-e"), responsavel: val("np-r"), demanda: $("np-de").value, objetivos: $("np-ob").value, encerramento: $("np-en").value
  };
  const pid = id || novoId("pacientes");
  gravar("pacientes", pid, id ? dados : { ...dados, criadoEm: serverTimestamp() });
  fechar(); state.paciente = pid; state.filtro = dados.status; location.hash = "pacientes"; render();
  toast(id ? "Cadastro atualizado." : (dados.dow !== null && dados.hora ? "Paciente cadastrada. Use Gerar sessões para montar a agenda." : "Paciente cadastrada."));
}
function excluirPaciente(id) {
  const p = P(id), n = state.sessoes.filter(s => s.pid === id).length;
  confirmar(`Excluir ${esc(p.nome)} e as ${n} sessões dela, com as evoluções registradas? O prontuário precisa ser guardado pelo prazo do CFP; baixe uma cópia em Configurações antes, se ainda não baixou.`, "Excluir definitivamente", async () => {
    try { await gravarEmLote([...state.sessoes.filter(s => s.pid === id).map(s => ({ tipo: "del", col: "sessoes", id: s.id })), ...state.documentos.filter(d => d.pid === id).map(d => ({ tipo: "del", col: "documentos", id: d.id })), { tipo: "del", col: "pacientes", id }]); state.paciente = null; render(); toast("Paciente excluída."); } catch (e) { falha(e); }
  }, true);
}

/* ================= documentos, carreira, configurações ================= */
function formDeclaracao(pid) {
  const ativos = state.pacientes.filter(p => state.sessoes.some(s => s.pid === p.id && s.status === "realizada"));
  if (!ativos.length) { toast("Nenhuma sessão realizada ainda."); return; }
  const p = pid && ativos.some(a => a.id === pid) ? P(pid) : ativos[0];
  const sess = state.sessoes.filter(s => s.pid === p.id && s.status === "realizada").slice().reverse();
  abrir(`<div class="head"><h2>Declaração de comparecimento</h2><button class="btn ghost sm" onclick="fechar()">Fechar</button></div>
    <div class="form" style="margin-bottom:12px">
      <div><label for="dc-p">Paciente</label><select id="dc-p" onchange="formDeclaracao(this.value)">${ativos.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></div>
      <div><label for="dc-s">Sessão</label><select id="dc-s" onchange="textoDeclaracao()">${sess.map(s => `<option value="${s.id}">${fmt(s.data)}, ${s.hora}</option>`).join("")}</select></div></div>
    <div class="preview" id="dc-t"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" onclick="copiarDeclaracao()">Copiar texto</button><button class="btn" onclick="registrarDeclaracao('${p.id}')">Registrar como emitida</button></div>
    <p class="note">A declaração informa só data e horário, sem nenhum conteúdo do atendimento.</p>`);
  textoDeclaracao();
}
function textoDeclaracao() {
  const s = S($("dc-s").value), p = P(s.pid), c = state.config;
  const [h, m] = s.hora.split(":").map(Number), fim = new Date(2000, 0, 1, h, m + 50);
  $("dc-t").textContent = `DECLARAÇÃO DE COMPARECIMENTO\n\nDeclaro, para os devidos fins, que ${p.nome} compareceu a atendimento psicológico ${s.local === "clinica" ? "presencial" : "online"} no dia ${fmtLong(s.data)}, das ${s.hora} às ${pad(fim.getHours())}:${pad(fim.getMinutes())}.\n\n${c.cidade || "Cidade"}, ${fmtLong(hojeIso())}.\n\n\n${c.nome || "Nome da psicóloga"}\nPsicóloga, CRP ${c.crp || "00/00000"}`;
}
function copiarDeclaracao() { navigator.clipboard.writeText($("dc-t").textContent).then(() => toast("Texto copiado.")).catch(() => toast("Não foi possível copiar. Selecione o texto e copie manualmente.")); }
function registrarDeclaracao(pid) { gravar("documentos", novoId("documentos"), { tipo: "Declaração de comparecimento", pid, data: hojeIso() }); fechar(); toast("Declaração registrada no histórico."); }
function registrarDocManual(tipo) {
  if (!state.pacientes.length) { toast("Cadastre uma paciente antes."); return; }
  abrir(`<div class="head"><h2>Registrar emissão<em>${esc(tipo)}</em></h2><button class="btn ghost sm" onclick="fechar()">Fechar</button></div>
  <form class="form" onsubmit="event.preventDefault();salvarDocManual()">
    <div><label for="rd-p">Paciente</label><select id="rd-p">${state.pacientes.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join("")}</select></div>
    <div><label for="rd-d">Data</label><input id="rd-d" type="date" value="${hojeIso()}" required></div>
    <input type="hidden" id="rd-t" value="${esc(tipo)}">
    <div class="full" style="display:flex;justify-content:flex-end"><button class="btn" type="submit">Registrar</button></div></form>`);
}
function salvarDocManual() { gravar("documentos", novoId("documentos"), { tipo: val("rd-t"), pid: val("rd-p"), data: val("rd-d") }); fechar(); toast("Emissão registrada."); }
function apagarItem(col, id) { confirmar("Excluir este registro?", "Excluir", () => apagar(col, id), true); }
function novaSupervisao() { gravar("supervisoes", novoId("supervisoes"), { data: val("sv-d"), tema: val("sv-t") || "A definir" }); }
function novaFormacao() { gravar("formacoes", novoId("formacoes"), { curso: val("fo-c"), horas: num("fo-h"), situacao: val("fo-s") }); }
function salvarPerfil() { gravarConfig({ nome: val("cf-n"), crp: val("cf-c"), cidade: val("cf-ci"), valorHoraSala: num("cf-v"), configurado: true }); toast("Dados salvos."); }
function salvarValorHora(v) { gravarConfig({ valorHoraSala: Number(v) || 0 }); }
function novaDespesa() { gravarConfig({ despesas: [...(state.config.despesas || []), { item: val("dp-i"), valor: num("dp-v") }] }); }
function removerDespesa(i) { const d = [...(state.config.despesas || [])]; d.splice(i, 1); gravarConfig({ despesas: d }); }

/* ================= exportação, cópia e restauração ================= */
function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const limpar = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === "object" && "seconds" in v && "nanoseconds" in v) ? new Date(v.seconds * 1000).toISOString() : v));
function exportarJSON() {
  const pacote = { sistema: "Consultório", versao: 1, exportadoEm: new Date().toISOString(), conta: state.user.email, config: limpar(state.config) };
  COLECOES.forEach(c => pacote[c] = limpar(state[c]));
  baixar(`Consultório cópia ${hojeIso()}.json`, JSON.stringify(pacote, null, 2), "application/json");
  gravarConfig({ ultimoBackup: hojeIso() });
  toast("Cópia baixada. Guarde o arquivo em local protegido.");
}
function exportarCSV(tipo) {
  const c = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let linhas;
  if (tipo === "pacientes") {
    linhas = [["Nome", "Idade", "CPF", "Situação", "Formato", "Dia fixo", "Horário", "Frequência", "Valor", "Valor social", "Início", "Origem", "Contato de emergência", "Responsável legal", "Demanda", "Objetivos", "Encerramento"],
      ...state.pacientes.map(p => [p.nome, p.idade, p.cpf, p.status, localTxt(p.local), p.dow !== null && p.dow !== undefined && p.dow !== "" ? DIAS[p.dow] : "", p.hora, p.freq, String(p.valor).replace(".", ","), p.social ? "sim" : "não", p.inicio, p.origem, p.emergencia, p.responsavel, p.demanda, p.objetivos, p.encerramento])];
  } else {
    linhas = [["Data", "Horário", "Paciente", "Formato", "Situação", "Falta cobrada", "Valor", "Pago", "Recibo emitido", "Evolução"],
      ...state.sessoes.map(s => [fmt(s.data) + "/" + s.data.slice(0, 4), s.hora, P(s.pid).nome, localTxt(s.local), s.status, s.cobrada ? "sim" : "não", String(s.valor).replace(".", ","), s.pago ? "sim" : "não", s.recibo ? "sim" : "não", s.evolucao])];
  }
  baixar(`Consultório ${tipo === "pacientes" ? "pacientes" : "sessões"} ${hojeIso()}.csv`, "﻿" + linhas.map(l => l.map(c).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  toast("Planilha baixada.");
}
function importarJSON(arq) {
  if (!arq) return;
  const r = new FileReader();
  r.onload = () => {
    let dados; try { dados = JSON.parse(r.result); } catch (e) { toast("Este arquivo não é uma cópia do sistema."); return; }
    if (dados.sistema !== "Consultório") { toast("Este arquivo não é uma cópia do sistema."); return; }
    const n = COLECOES.reduce((a, c) => a + (dados[c] || []).length, 0);
    confirmar(`Restaurar a cópia de ${fmtLong(dados.exportadoEm.slice(0, 10))}, com ${(dados.pacientes || []).length} pacientes e ${(dados.sessoes || []).length} sessões? Registros com o mesmo código são substituídos pela versão da cópia; o que foi criado depois da cópia continua no sistema.`, "Restaurar", async () => {
      const ops = [];
      COLECOES.forEach(c => (dados[c] || []).forEach(({ id, ...resto }) => { delete resto.criadoEm; ops.push({ tipo: "set", col: c, id, dados: resto }); }));
      try {
        await gravarEmLote(ops);
        if (dados.config) { const { ultimoBackup, ...cfg } = dados.config; await gravarConfig(cfg); }
        toast(`${n} registros restaurados.`);
      } catch (e) { falha(e); }
    });
  };
  r.readAsText(arq);
}

/* ================= dados de exemplo ================= */
async function carregarExemplos() {
  const t = hoje(), base = [
    ["Mariana Albuquerque", 34, "online", 2, "08:00", "semanal", 220, "Ansiedade relacionada ao trabalho e dificuldade de impor limites com a equipe.", "Reconhecer gatilhos de ansiedade e treinar comunicação assertiva."],
    ["Rafael Monteiro", 41, "clinica", 3, "18:00", "semanal", 250, "Luto recente pela perda do pai.", "Acolher o processo de luto e reorganizar a rotina."],
    ["Camila Rezende", 29, "online", 1, "19:00", "semanal", 220, "Autocrítica intensa.", "Trabalhar autoestima e flexibilizar padrões de exigência."],
    ["Beatriz Lacerda", 16, "clinica", 5, "16:00", "semanal", 250, "Ansiedade em provas e isolamento social.", "Desenvolver recursos para lidar com a ansiedade escolar."],
    ["Luísa Pimentel", 38, "online", 4, "07:00", "semanal", 160, "Esgotamento na conciliação entre maternidade e trabalho.", "Reconhecer limites e redistribuir responsabilidades."],
    ["Thiago Vasconcelos", 33, "online", 2, "20:00", "semanal", 220, "Conflitos no relacionamento afetivo.", "Compreender padrões relacionais."],
    ["Patrícia Nogueira", 45, "clinica", 3, "19:00", "semanal", 250, "Episódios depressivos, em acompanhamento psiquiátrico.", "Fortalecer rotina e rede de apoio."],
    ["Juliana Fontes", 27, "online", 1, "08:00", "quinzenal", 220, "Insegurança na transição de carreira.", "Clarear valores e tomar decisões com mais segurança."],
    ["Eduardo Sampaio", 52, "clinica", 5, "17:00", "semanal", 250, "Irritabilidade após a aposentadoria.", "Reconstruir sentido e rotina na nova fase."]
  ];
  const evos = ["Paciente trouxe situações da semana ligadas à demanda principal. Combinamos um registro para a próxima sessão.", "Retomada do registro da semana. Paciente relatou avanço em uma situação antes evitada.", "Paciente chegou mobilizado por um conflito recente. Acolhimento e organização do relato.", "Revisão dos objetivos do processo. Paciente percebe mudanças na forma de reagir."];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ops = [];
  base.forEach(([nome, idade, local, dow, hora, freq, valor, demanda, objetivos]) => {
    const pid = novoId("pacientes");
    ops.push({ tipo: "set", col: "pacientes", id: pid, dados: { nome: nome + " (exemplo)", idade, cpf: "", status: "atendimento", local, dow, hora, freq, valor, social: valor < 200, inicio: iso(addDays(t, -70)), origem: "Exemplo", emergencia: "", responsavel: idade < 18 ? "Mãe, autorização assinada" : "", demanda, objetivos, encerramento: "", exemplo: true } });
    let d = addDays(t, -56); while (d.getDay() !== dow) d = addDays(d, 1);
    for (; d <= addDays(t, 28); d = addDays(d, freq === "quinzenal" ? 14 : 7)) {
      const ds = iso(d), passado = ds < iso(t);
      let status = "agendada", cobrada = false, pago = false, recibo = false, evolucao = "";
      if (passado) { const r = rnd(); status = r < 0.08 ? "falta" : "realizada"; cobrada = status === "falta" && rnd() < 0.5; if (status === "realizada" || cobrada) { pago = rnd() < 0.85; recibo = pago && rnd() < 0.8; } if (status === "realizada") evolucao = rnd() < 0.85 ? evos[Math.floor(rnd() * evos.length)] : ""; }
      ops.push({ tipo: "set", col: "sessoes", id: novoId("sessoes"), dados: { pid, data: ds, hora, local, valor, status, cobrada, pago, recibo, evolucao, exemplo: true } });
    }
  });
  try { toast("Carregando os exemplos…"); await gravarEmLote(ops); toast("Dados de exemplo carregados."); location.hash = "painel"; } catch (e) { falha(e); }
}
function apagarExemplos() {
  confirmar("Apagar todas as pacientes e sessões marcadas como exemplo? Os seus dados reais não são tocados.", "Apagar exemplos", async () => {
    const ids = new Set(state.pacientes.filter(p => p.exemplo).map(p => p.id));
    const ops = [...state.sessoes.filter(s => s.exemplo || ids.has(s.pid)).map(s => ({ tipo: "del", col: "sessoes", id: s.id })), ...state.documentos.filter(d => ids.has(d.pid)).map(d => ({ tipo: "del", col: "documentos", id: d.id })), ...[...ids].map(id => ({ tipo: "del", col: "pacientes", id }))];
    try { await gravarEmLote(ops); toast("Exemplos apagados."); } catch (e) { falha(e); }
  }, true);
}

/* ================= funções usadas no HTML ================= */
Object.assign(window, { $, entrar, criarConta, modoLogin, esqueci, trocarSenha, sair, mudaSemana, mudaMes, setFiltro, buscar, abrirPaciente, voltarLista, fechar, abrirSessao, setStatus, setCampo, salvarEvo, marcarRecibo, excluirSessao, formSessao, salvarSessao, formGerar, gerarSessoes, formPaciente, salvarPaciente, excluirPaciente, formDeclaracao, textoDeclaracao, copiarDeclaracao, registrarDeclaracao, registrarDocManual, salvarDocManual, apagarItem, novaSupervisao, novaFormacao, salvarPerfil, salvarValorHora, novaDespesa, removerDespesa, exportarJSON, exportarCSV, importarJSON, carregarExemplos, apagarExemplos });
if (!navigator.onLine) $("offline").style.display = "block";
render();
