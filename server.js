const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const PORT = process.env.PORT || 3000;

/**
 * Memória simples por número (in-memory)
 * Se você reiniciar o servidor, zera. Depois a gente troca por Redis/DB se quiser.
 */
const conversations = new Map();
// Ajustes de memória
const MAX_TURNS = 18; // mantém as últimas interações (user+assistant)
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function humanDelayMs(text) {
  // Delay "humano" baseado no tamanho do texto
  // mínimo 900ms, máximo 3500ms
  const base = 900;
  const perChar = Math.min(8, Math.max(2, Math.floor((text || "").length / 40)));
  const jitter = Math.floor(Math.random() * 500);
  const calc = base + perChar * 120 + jitter;
  return Math.max(900, Math.min(calc, 3500));
}

function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function getSession(from) {
  const s = conversations.get(from);
  if (!s) return null;
  if (now() - s.updatedAt > SESSION_TTL_MS) {
    conversations.delete(from);
    return null;
  }
  return s;
}

function upsertSession(from) {
  let s = getSession(from);
  if (!s) {
    s = { messages: [], updatedAt: now() };
    conversations.set(from, s);
  }
  s.updatedAt = now();
  return s;
}

function pushTurn(session, role, content) {
  session.messages.push({ role, content });
  // corta histórico
  if (session.messages.length > MAX_TURNS * 2) {
    session.messages = session.messages.slice(session.messages.length - MAX_TURNS * 2);
  }
}

async function sendWhatsAppText(to, body) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/**
 * Respostas “hard rules” para não depender do GPT e evitar erro de horário/localização.
 */
const INFO = {
  arsenal: {
    name: "Arsenal da Cerveja",
    instagram: "@arsenaldacerveja",
    site: "https://www.arsenaldacerveja.com.br",
    email: "arsenaldacerveja@gmail.com",
    phone: "+55 35 3886-0004",
  },
  lojas: {
    galeriaSuica: {
      nome: "Arsenal da Cerveja - Galeria Suíça",
      endereco: "Av. Monte Verde, 858, Galeria Suíça, Loja 4 (próximo ao lago)",
      maps: "https://www.google.com/maps/search/?api=1&query=Av.+Monte+Verde,+858,+Monte+Verde,+MG",
      horario: [
        "Segunda: fechado",
        "Terça: fechado",
        "Quarta: 10h às 19h",
        "Quinta: 10h às 19h",
        "Sexta: 10h às 23h",
        "Sábado: 10h às 00h",
        "Domingo: 10h às 19h",
      ],
      perfil: "Loja mais experiência, com porções e petiscos (queijos e embutidos da região), 6 torneiras de chope e mais de 200 rótulos.",
    },
    vilaGermanica: {
      nome: "Arsenal da Cerveja Store - Vila Germânica",
      endereco: "Av. Monte Verde, 1057, Galeria Vila Germânica (próximo ao Bradesco)",
      maps: "https://www.google.com/maps/search/?api=1&query=Av.+Monte+Verde,+1057,+Monte+Verde,+MG",
      horario: [
        "Domingo a quinta: 10h às 19h",
        "Sexta: 10h às 23h",
        "Sábado: 10h às 00h",
      ],
      perfil: "Loja menor, focada em kits e taças, com 6 torneiras de chope e variedade de rótulos.",
    },
  },
  degustacao: {
    nome: "Régua Degustação",
    descricao:
      "Você escolhe 4 estilos entre 6 opções de chope. Cada taça tem 200ml (total 800ml). Valor: R$60. Dá pra dividir em casal.",
  },
  kitAnuncio: {
    nome: "Kit Especial do anúncio",
    descricao:
      "Kit com 2 cervejas Pilsen da casa por R$39,90 (Arsenal Pilsner com lúpulo alemão e malte nacional).",
    regra:
      "Normalmente não precisa reservar. É só chegar na loja e pegar por ordem de chegada, enquanto durar o estoque.",
  },
  online: {
    contatoNome: "Kaique",
    contatoTitulo: "sommelier responsável pela curadoria",
    contatoFone: "+55 35 99902-2256",
    entrega: "Envio via PAC ou Sedex para todo o Brasil (seleção e montagem de kits pelo Kaique).",
  },
  influencers: {
    contatoNome: "Kelvin",
    contatoEmpresa: "Socialize",
    contatoFone: "+55 35 99189-7704",
    regra:
      "Parcerias e visitas de influencers são alinhadas com o Kelvin. Pedir mídia kit e proposta por WhatsApp.",
  },
  fornecedores: {
    contatoNome: "Rafael",
    contatoFone: "+55 35 99157-5013",
    regra: "Assuntos de fornecedores e propostas comerciais: falar direto com o Rafael nesse número.",
  },
  smarttap: {
    nome: "SmartTap",
    resumo:
      "Máquina autônoma de chope: pagamento via Pix e liberação automática. Tem validação de CPF para bloquear menor de 18 anos e sistema de lavagem automática de alta pressão.",
    problemas: {
      naoSai:
        "Se o chope não sair, pode ficar tranquilo: o sistema faz o estorno automaticamente. Se quiser, me diga o horário aproximado e o final do CPF (apenas os 3 últimos dígitos) pra eu checar mais rápido.",
      espumando:
        "Se estiver espumando muito, pode ser inclinação do copo ou jeito de servir. Me fala qual torneira e se você está usando copo bem gelado, que eu te passo o passo a passo rápido.",
      pagamentoDelay:
        "Às vezes o Pix pode levar um pouquinho para confirmar. Se confirmar e não liberar, o sistema estorna automaticamente. Me diga a torneira e o horário aproximado pra eu acompanhar.",
      naoEstornou:
        "Se ainda não apareceu o estorno, me diga o horário aproximado e os 3 últimos dígitos do CPF pra eu conferir no sistema.",
    },
    franquia: {
      regra:
        "A franquia está em fase de estruturação (COF). Para receber informações assim que liberar, envie: nome completo, cidade/UF, telefone e e-mail.",
    },
  },
};

function buildHoursText() {
  const suica = INFO.lojas.galeriaSuica;
  const vila = INFO.lojas.vilaGermanica;
  return (
    `Horários das lojas:\n\n` +
    `${suica.nome}\n` +
    `${suica.endereco}\n` +
    `${suica.horario.map((h) => `- ${h}`).join("\n")}\n\n` +
    `${vila.nome}\n` +
    `${vila.endereco}\n` +
    `${vila.horario.map((h) => `- ${h}`).join("\n")}`
  );
}

function buildLocationText(which) {
  if (which === "suica") {
    const s = INFO.lojas.galeriaSuica;
    return `${s.nome}\n${s.endereco}\nMaps: ${s.maps}`;
  }
  if (which === "vila") {
    const v = INFO.lojas.vilaGermanica;
    return `${v.nome}\n${v.endereco}\nMaps: ${v.maps}`;
  }
  // ambos
  const s = INFO.lojas.galeriaSuica;
  const v = INFO.lojas.vilaGermanica;
  return (
    `Localização das lojas:\n\n` +
    `${s.nome}\n${s.endereco}\nMaps: ${s.maps}\n\n` +
    `${v.nome}\n${v.endereco}\nMaps: ${v.maps}`
  );
}

function detectStore(messageNorm) {
  // tenta inferir qual loja
  if (messageNorm.includes("bradesco") || messageNorm.includes("vila germanica") || messageNorm.includes("1057") || messageNorm.includes("store")) {
    return "vila";
  }
  if (messageNorm.includes("lago") || messageNorm.includes("galeria suica") || messageNorm.includes("858") || messageNorm.includes("suica")) {
    return "suica";
  }
  return null;
}

function isAskingLocation(messageNorm) {
  const keys = ["localizacao", "localização", "endereco", "endereço", "maps", "como chegar", "gps", "pin"];
  return keys.some((k) => messageNorm.includes(normalize(k)));
}

function isAskingHours(messageNorm) {
  const keys = ["horario", "horários", "funcionamento", "abre", "fecha", "aberto", "hoje ta aberto", "hoje está aberto"];
  return keys.some((k) => messageNorm.includes(normalize(k)));
}

function isAskingRuler(messageNorm) {
  return messageNorm.includes("regua") || messageNorm.includes("degust");
}

function isAskingKit(messageNorm) {
  return messageNorm.includes("kit") || messageNorm.includes("39,90") || messageNorm.includes("39.90") || messageNorm.includes("anuncio") || messageNorm.includes("anúncio");
}

function isAskingPet(messageNorm) {
  return messageNorm.includes("pet") || messageNorm.includes("cachorro") || messageNorm.includes("animal");
}

function isAskingOnline(messageNorm) {
  const keys = ["envia", "enviam", "entrega", "comprar online", "internet", "sedex", "pac", "manda pra", "mandar pra", "enviar para"];
  return keys.some((k) => messageNorm.includes(normalize(k)));
}

function isInfluencer(messageNorm) {
  const keys = ["influencer", "parceria", "midiakit", "media kit", "permuta", "divulgar", "visita", "criador de conteudo"];
  return keys.some((k) => messageNorm.includes(normalize(k)));
}

function isSupplier(messageNorm) {
  const keys = ["fornecedor", "representante", "distribuidor", "proposta", "comercial", "orcamento", "orçamento", "revenda"];
  return keys.some((k) => messageNorm.includes(normalize(k)));
}

function isSmartTap(messageNorm) {
  return messageNorm.includes("smarttap") || messageNorm.includes("smart tap") || messageNorm.includes("torneira") || messageNorm.includes("pix") || messageNorm.includes("estorno") || messageNorm.includes("chope") || messageNorm.includes("chopp");
}

function isFranchise(messageNorm) {
  const keys = ["franquia", "virar franqueado", "quanto custa", "investimento", "cof", "circular de oferta"];
  return keys.some((k) => messageNorm.includes(normalize(k)));
}

/**
 * Prompt principal: ele deve seguir as regras e nunca inventar.
 * Importante: ele NÃO deve “prometer” enviar pin. Quando pedirem, mande o link Maps.
 */
const SYSTEM_PROMPT = `
Você é o atendimento do Arsenal da Cerveja e SmartTap em Monte Verde.
Fale natural, direto e simpático. Sem parecer robô.
Regras importantes:
1) Não invente horários, regras, preços, estoque ou informações não confirmadas.
2) Se o usuário pedir "localização/endereço/maps", responda já com o endereço e um link de Google Maps (não prometa "vou enviar" sem enviar).
3) Não reinicie conversa com "Oi, como posso ajudar?" depois que a pessoa já está conversando.
4) Se a pessoa disser só "sim", "pode", "quero", você deve entender o contexto do histórico e continuar o fluxo.
5) Seja prático, turista geralmente já está em Monte Verde.
6) Não fale de visitação de cervejaria. Explique que é uma loja especializada e pronto.

Informações fixas (use exatamente):
- Arsenal da Cerveja: loja especializada em cervejas especiais, +200 rótulos nacionais e importados.
- Lojas:
(1) Arsenal da Cerveja - Galeria Suíça
Endereço: Av. Monte Verde, 858, Galeria Suíça, Loja 4 (próximo ao lago)
Horários:
Segunda: fechado
Terça: fechado
Quarta: 10h às 19h
Quinta: 10h às 19h
Sexta: 10h às 23h
Sábado: 10h às 00h
Domingo: 10h às 19h
Maps: https://www.google.com/maps/search/?api=1&query=Av.+Monte+Verde,+858,+Monte+Verde,+MG

(2) Arsenal da Cerveja Store - Vila Germânica
Endereço: Av. Monte Verde, 1057, Galeria Vila Germânica (próximo ao Bradesco)
Horários:
Domingo a quinta: 10h às 19h
Sexta: 10h às 23h
Sábado: 10h às 00h
Maps: https://www.google.com/maps/search/?api=1&query=Av.+Monte+Verde,+1057,+Monte+Verde,+MG

- Carro-chefe: Régua Degustação (nas duas lojas)
Você escolhe 4 estilos entre 6 opções de chope. Cada taça tem 200ml (total 800ml). Valor R$60. Pode dividir em casal.

- Kit do anúncio (Instagram):
Kit com 2 cervejas Pilsen da casa por R$39,90. Normalmente não precisa reservar, é só chegar e pegar por ordem de chegada, enquanto durar o estoque.

- Pets: aceitamos pets.

- Venda/Envio online:
Direcionar para Kaique (sommelier responsável pela curadoria): +55 35 99902-2256
Ele ajuda a escolher rótulos e montar kits e envia via PAC/Sedex.

- Influencers/parcerias:
Direcionar para Kelvin (Socialize): +55 35 99189-7704
Pedir mídia kit e proposta.

- Fornecedores:
Direcionar para Rafael: +55 35 99157-5013

- SmartTap:
Máquina autônoma de chope: pagamento via Pix e liberação automática.
Validação de CPF para bloquear menor de 18 anos.
Lavagem automática de alta pressão.
Se chope não liberar: estorno é automático. Não cite tempos exatos. Peça horário aproximado e (se necessário) apenas os 3 últimos dígitos do CPF.
- Franquia SmartTap:
Estamos estruturando a COF. Para receber infos quando liberar, pedir: nome completo, cidade/UF, telefone e e-mail.
`;

/* ROTA RAIZ */
app.get("/", (req, res) => {
  res.send("Chatbot Arsenal está rodando.");
});

/* VALIDAÇÃO DO WEBHOOK META */
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

/* RECEBIMENTO DE MENSAGENS */
app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;

    const from =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

    if (!message || !from) {
      return res.sendStatus(200);
    }

    const msgNorm = normalize(message);

    // cria/recupera sessão
    const session = upsertSession(from);

    // guarda mensagem do usuário
    pushTurn(session, "user", message);

    /**
     * 1) Regras duras (não deixar o GPT errar)
     */
    // Localização / endereço
    if (isAskingLocation(msgNorm)) {
      const store = detectStore(msgNorm);
      let reply;
      if (store === "suica") reply = buildLocationText("suica");
      else if (store === "vila") reply = buildLocationText("vila");
      else {
        reply =
          "Você quer a localização de qual loja?\n\n1) Galeria Suíça (próximo ao lago)\n2) Vila Germânica (próximo ao Bradesco)\n\nSe preferir, já te mando as duas.";
      }

      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Horários
    if (isAskingHours(msgNorm)) {
      const reply = buildHoursText();
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Régua degustação
    if (isAskingRuler(msgNorm)) {
      const reply =
        `Nossa ${INFO.degustacao.nome} funciona assim:\n` +
        `${INFO.degustacao.descricao}\n\n` +
        `Quer ir em qual loja hoje? Se quiser, te mando a localização no Maps.`;
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Kit do anúncio
    if (isAskingKit(msgNorm)) {
      const reply =
        `${INFO.kitAnuncio.nome} 😄\n` +
        `${INFO.kitAnuncio.descricao}\n` +
        `${INFO.kitAnuncio.regra}\n\n` +
        `Quer pegar em qual loja, Galeria Suíça (próximo ao lago) ou Vila Germânica (perto do Bradesco)?`;
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Pet
    if (isAskingPet(msgNorm)) {
      const reply = "Aceitamos pets sim 😊 Pode trazer sem problema. Quer a localização de qual loja no Maps?";
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Envio / internet
    if (isAskingOnline(msgNorm)) {
      const reply =
        `Enviamos sim 😊\n` +
        `${INFO.online.entrega}\n\n` +
        `Pra te indicar certeiro, chama o ${INFO.online.contatoNome}, nosso ${INFO.online.contatoTitulo}:\n` +
        `${INFO.online.contatoFone}`;
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Influencer
    if (isInfluencer(msgNorm)) {
      const reply =
        `Legal! Parcerias com influencers a gente alinha por aqui:\n` +
        `${INFO.influencers.contatoNome} (Socialize) - ${INFO.influencers.contatoFone}\n\n` +
        `Pode enviar seu mídia kit e a ideia da parceria pra ele que ele te responde com o formato certinho.`;
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Fornecedor
    if (isSupplier(msgNorm)) {
      const reply =
        `Perfeito. Assuntos de fornecedor/propostas comerciais é direto com o ${INFO.fornecedores.contatoNome}:\n` +
        `${INFO.fornecedores.contatoFone}\n\n` +
        `Me chama lá com uma descrição rápida do produto e condições.`;
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    // Franquia SmartTap (lead)
    if (isFranchise(msgNorm)) {
      const reply =
        `A franquia da SmartTap está em fase de estruturação (COF). 👇\n\n` +
        `Se você quiser receber as infos assim que liberar, me manda:\n` +
        `- Nome completo\n- Cidade/UF\n- Telefone\n- E-mail`;
      pushTurn(session, "assistant", reply);
      await sleep(humanDelayMs(reply));
      await sendWhatsAppText(from, reply);
      return res.sendStatus(200);
    }

    /**
     * 2) Fora das regras duras, cai no GPT com memória
     */
    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        temperature: 0.6,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...session.messages],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const reply = openaiResponse.data?.choices?.[0]?.message?.content?.trim() || "Consegue me dizer um pouco mais do que você precisa?";

    pushTurn(session, "assistant", reply);

    // Delay humano antes de responder
    await sleep(humanDelayMs(reply));
    await sendWhatsAppText(from, reply);

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
