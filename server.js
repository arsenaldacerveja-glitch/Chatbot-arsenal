/**
 * WhatsApp Cloud API + OpenAI (bot Arsenal da Cerveja + SmartTap)
 * Objetivo: fluxo profissional, sem perder contexto, respostas diretas e vendedoras.
 *
 * Como usar:
 * 1) npm i express axios dotenv
 * 2) crie .env com:
 *    PORT=3000
 *    VERIFY_TOKEN=coloque_um_token_qualquer
 *    WHATSAPP_TOKEN=EAAG...
 *    WHATSAPP_PHONE_NUMBER_ID=1234567890
 *    OPENAI_API_KEY=sk-...
 *    OPENAI_MODEL=gpt-5.2-mini
 *    WEBSITE_URL=https://SEU-SITE-AQUI (ultimo caso)
 *    IMG_REGUA_URL=https://URL-PUBLICA-DA-FOTO-REGUA.jpg (opcional)
 *
 * 3) node index.js
 *
 * Observações importantes:
 * - Para mandar imagem no WhatsApp, a URL precisa ser pública (https). Google Drive “view” costuma falhar.
 * - Este código mantém contexto por usuário em memória. Para produção, troque por Redis/DB.
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

const {
  PORT,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  WEBSITE_URL,
  IMG_REGUA_URL,
} = process.env;

if (!PORT || !VERIFY_TOKEN || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !OPENAI_API_KEY) {
  console.error("Faltam variáveis no .env. Confira PORT, VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, OPENAI_API_KEY.");
  process.exit(1);
}

/* -------------------------
   Memória simples por usuário
-------------------------- */
const sessions = new Map(); // wa_id -> { messages: [{role, content}], lastIntent, lastStore, lastAskedLocation, lastAskedMenu, ... }
const processedMsgIds = new Set(); // idempotência básica

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      messages: [],
      lastIntent: null,
      lastStore: null,
      lastAskedLocation: false,
      lastAskedMenu: false,
      lastAskedHours: false,
      lastAskedChopp: false,
      lastEscalationCount: 0,
    });
  }
  return sessions.get(waId);
}

function pushMsg(session, role, content) {
  session.messages.push({ role, content });
  // Mantém só as últimas 16 mensagens pra não estourar token
  if (session.messages.length > 16) session.messages = session.messages.slice(-16);
}

/* -------------------------
   Conhecimento fixo e regras do negócio
-------------------------- */
const KNOWLEDGE_BASE = `
VOCÊ É O ASSISTENTE OFICIAL DO ARSENAL DA CERVEJA (Monte Verde - MG) E TAMBÉM DA SMARTTAP.

TOM E ESTILO:
- Responda em português BR.
- Seja animado, acolhedor, e prático.
- Sempre que fizer sentido, puxe o cliente para a experiência: régua degustação, tábua de frios, visita na loja, SmartTap 24h.
- Use pontuação simples. Não use travessão longo.

UNIDADES:
1) Arsenal da Cerveja - Galeria Suíça (tem porções e experiência completa)
- Endereço: Av. Monte Verde, 858, Galeria Suíça, Loja 4, Monte Verde - MG.
- Diferencial: porções de queijos e embutidos da região (Minas), tábua de frios (carro chefe das porções), régua degustação (carro chefe da casa).
- Horários:
  - Segunda: fechado
  - Terça: fechado
  - Quarta: 10h às 19h
  - Quinta: 10h às 19h
  - Sexta: 10h às 23h
  - Sábado: 10h à 00h
  - Domingo: 10h às 19h

2) Arsenal Store - Galeria Vila Germânica (foco em chopes e cervejas)
- Endereço: Av. Monte Verde, 1057, Galeria Vila Germânica, Monte Verde - MG (próximo ao Bradesco).
- Não tem porções de queijos e embutidos. É mais para beber e escolher cervejas.
- Horários:
  - Domingo a Quinta: 10h às 19h
  - Sexta: 10h às 23h
  - Sábado: 10h à 00h

3) SmartTap - Galeria Itália (parte do ecossistema do Arsenal)
- Endereço: Av. Monte Verde, 561, Galeria Itália, Monte Verde - MG.
- Horário: 24 horas, todos os dias. Não fecha.
- Modelo: autoatendimento por Pix.
- Na SmartTap normalmente tem fixo: Pilsen, IPA, Dunkel, Chopp de vinho, Cannabis, e Gin tônica com frutas amarelas.

LOCALIZAÇÃO (links):
- Você vai enviar links do Google Maps em formato simples.
- Se o cliente pedir localização, não repita "quer que eu envie a localização?" depois de já ter enviado. Só envie e pronto.
- Se o cliente pedir “das duas”, envie as duas lojas e também a SmartTap (ecossistema).
- Se o cliente estiver falando de porções, direcione para Galeria Suíça. Se estiver falando de “só beber chope e escolher cervejas”, pode ser Vila Germânica.

RÉGUA DEGUSTAÇÃO (sempre vender quando fizer sentido):
- O carro chefe da casa.
- Funciona assim: escolhe 4 estilos entre 6 chopes, 200ml cada taça (total 800ml).
- Valor: R$60.
- Use como gancho para horários, localização e cardápio.

PETS:
- Aceitamos pets.
- Temos uma cerveja feita especialmente para pets.
- Convite: “te explico certinho na loja e você já conhece a opção pra pet”.

ENVIO PARA TODO O BRASIL:
- Enviamos via PAC ou Sedex.
- Para curadoria e kit, fale do Kaique (Beer Sommelier, formado no Instituto da Cerveja Brasil - ICB).
- Contato do Kaique (com K): +55 35 99902-2256.
- Use um texto mais lúdico: ele ajuda com estilo, temperatura, taça, presente, harmonização.

COPOS, TAÇAS, CANECAS:
- Temos variedade de copos, taças e canecas personalizadas, e também importadas.
- Se o cliente quiser comprar e enviar, direcione para o Kaique +55 35 99902-2256.

CARDÁPIO GALERIA SUÍÇA (explicar bem completo, do jeito do cardápio, e com tábua de frios em evidência):
- TÁBUA DE FRIOS (carro chefe das porções): Brie, Gouda, Gorgonzola, Parmesão, Eisbein defumado, linguiça defumada recheada com provolone, lombo condimentado, salame.
  Acompanha: torradas, chutney de cebola e especiarias, geleia de morango, molho de mostarda com maracujá, e molho agridoce com gengibre.
  Valor: R$110.

- MIX DE EMBUTIDOS: Eisbein defumado, linguiça defumada recheada com provolone, lombo condimentado, salame.
  Acompanha: torradas, mostarda com maracujá e chutney de cebola e especiarias.
  Valor: R$70.

- MIX DE QUEIJOS: Brie, Gouda, Gorgonzola, Parmesão.
  Acompanha: torradas, geleia de morango, chutney de cebola e especiarias.
  Valor: R$70.

- PORÇÕES INDIVIDUAIS:
  Mix de embutidos individual:
  - Eisbein defumado: R$40 (acompanha torradas e geleia de pimenta)
  - Lombo condimentado: R$40 (acompanha molho agridoce com gengibre)
  - Linguiça defumada recheada com provolone: R$40 (acompanha torradas e mostarda com maracujá)
  - Salame: R$30

  Mix de queijos individual:
  - Brie com geleia de morango: R$45 (acompanha torradas)
  - Gouda: R$45 (acompanha torradas)
  - Gorgonzola: R$45 (acompanha torradas)
  - Parmesão: R$45 (acompanha torradas)

IMPORTANTE: O turista pode achar que é restaurante. Responda sem “não somos restaurante”.
Diga que é um empório de cervejas especiais com experiência de chopes e porções mineiras na Galeria Suíça, e outra unidade focada em chopes e cervejas na Vila Germânica.

CHOPP ENGATADO HOJE:
- Não prometa o que está engatado no dia porque muda.
- Diga que varia por loja e sazonalidade.
- Dê exemplos de estilos que costumam aparecer (sem marca): Pilsen, Witbier, American IPA, Double IPA, New England IPA, Double New England, Imperial Stout, Fruitbier (maçã verde), Chopp de vinho, Sour.
- Feche com convite para ir e com gancho da régua degustação.

PARCERIAS E INFLUENCERS:
- Seja direto.
- Peça @ do Instagram, cidade e proposta.
- Passe o contato do Kelvim de cara: +55 35 99189-7704.
- Não diga que “não tem o contato”. Você tem.

SMARTTAP - CHOPE NÃO SAIU / ESTORNO:
- O cliente está nervoso. Acolha primeiro.
- Não fale de módulo, reiniciar nada, nem instrução técnica de equipamento.
- Objetivo: resolver o Pix e orientar.
- Faça perguntas simples:
  1) Você ainda está perto da SmartTap?
  2) Qual horário aproximado do Pix?
  3) Você consegue mandar um print do comprovante do Pix?
- Explique: em geral o estorno é automático, pode cair em instantes, mas pode variar de banco para banco.
- Se a pessoa estiver perto, peça para ela tentar de novo só se ela quiser, sem pressionar. Priorize estorno.
- Se precisar escalar, peça um telefone para retorno humano ou direcione para suporte interno (se você tiver). Se não tiver, peça print e horário e diga que a equipe vai checar.

FALLBACK (ultimo caso):
- Se você não tiver a informação correta, ou o cliente insistir em algo muito específico que você não consegue confirmar, diga:
  “Pra não te passar informação errada, vou te mandar nosso site oficial.”
  Use WEBSITE_URL do ambiente.
`;

/* -------------------------
   Prompt do sistema (com fluxo forte)
-------------------------- */
function buildSystemPrompt() {
  return `
${KNOWLEDGE_BASE}

REGRAS DE CONVERSA (para não travar e não perder contexto):
- Identifique a intenção do cliente em 1 passo (horário, localização, cardápio, régua, chopp, envio, copos, pets, SmartTap, estorno, franquia, influencer).
- Responda direto com a informação. Depois, ofereça 1 próxima ação.
- Não repita pergunta que você acabou de fazer.
- Se o cliente escreveu algo curto tipo “Sim”, “Pode”, “Ok”, entenda o contexto anterior e avance.
- Sempre que responder horário, localização ou cardápio, tente vender a régua degustação (1 frase curta).
- Se a Galeria Suíça estiver fechada (segunda ou terça), ofereça alternativa: SmartTap 24h e/ou Arsenal Store Vila Germânica.
- Quando o cliente pedir “cardápio”, pergunte qual unidade apenas se realmente precisar. Se ele não especificar, assuma Galeria Suíça (por ter porções) e pergunte no final se ele queria da outra unidade.
- Quando o cliente pedir “localização”, envie os links direto, sem enrolar.

FORMATO:
- Respostas curtas e claras.
- Use listas quando for cardápio e horários.
- Emojis com moderação: 🍻🧀🐾📍 só quando fizer sentido.

IMAGEM DA RÉGUA:
- Se o cliente pedir foto da régua, e existir IMG_REGUA_URL, responda com uma frase e indique que vai enviar a imagem.
- Se não existir, peça para ele preferir ir na loja ou ver no Instagram/site, e ofereça a régua como experiência.

SEMPRE CONFIRA:
- SmartTap é 24h todos os dias.
- Vila Germânica abre todos os dias com horários definidos.
- Galeria Suíça fecha segunda e terça.
- Kelvim e Kaique com contatos fixos.
`;
}

/* -------------------------
   WhatsApp: enviar texto
-------------------------- */
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/* -------------------------
   WhatsApp: enviar imagem por URL pública
-------------------------- */
async function sendWhatsAppImage(to, imageUrl, caption) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: imageUrl,
        caption: caption || "",
      },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/* -------------------------
   OpenAI: gerar resposta
   - Usa Responses API style (compatível via axios)
-------------------------- */
async function generateAIReply(session, userText) {
  const systemPrompt = buildSystemPrompt();

  const inputMessages = [
    { role: "system", content: systemPrompt },
    ...session.messages,
    { role: "user", content: userText },
  ];

  const resp = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: OPENAI_MODEL || "gpt-5.2-mini",
      input: inputMessages,
      // resposta mais estável e consistente
      temperature: 0.4,
      max_output_tokens: 450,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  const outputText =
    resp.data?.output?.[0]?.content?.find((c) => c.type === "output_text")?.text ||
    resp.data?.output_text ||
    "";

  return outputText.trim();
}

/* -------------------------
   Heurísticas rápidas (sem depender só do modelo)
   - para evitar erros críticos: SmartTap 24h, estorno, influencer contato, imagem da régua
-------------------------- */
function looksLikeRefundIssue(text) {
  const t = text.toLowerCase();
  return (
    t.includes("não saiu") ||
    t.includes("nao saiu") ||
    t.includes("meu chope") ||
    t.includes("meu chopp") ||
    t.includes("estorno") ||
    t.includes("pix") ||
    t.includes("paguei") ||
    t.includes("pagamento")
  );
}

function looksLikeInfluencer(text) {
  const t = text.toLowerCase();
  return t.includes("influencer") || t.includes("parceria") || t.includes("media kit");
}

function wantsRulerPhoto(text) {
  const t = text.toLowerCase();
  return t.includes("foto") && (t.includes("régua") || t.includes("regua") || t.includes("degust"));
}

/* -------------------------
   Rotas Meta Webhook
-------------------------- */

// Verificação do webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recebe mensagens
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from; // wa_id do cliente
    const msgId = msg.id;

    // idempotência
    if (processedMsgIds.has(msgId)) return res.sendStatus(200);
    processedMsgIds.add(msgId);
    // limpa set de vez em quando
    if (processedMsgIds.size > 5000) processedMsgIds.clear();

    const userText =
      msg.text?.body ||
      msg.button?.text ||
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title ||
      "";

    if (!userText) return res.sendStatus(200);

    const session = getSession(from);
    pushMsg(session, "user", userText);

    // Atalho: foto da régua
    if (wantsRulerPhoto(userText)) {
      if (IMG_REGUA_URL) {
        const caption = "🍻 Régua degustação do Arsenal. Você escolhe 4 estilos, 200ml cada taça. Quer que eu te mande a localização da Galeria Suíça ou da Arsenal Store na Vila Germânica?";
        await sendWhatsAppImage(from, IMG_REGUA_URL, caption);
        pushMsg(session, "assistant", caption);
        return res.sendStatus(200);
      } else {
        const fallbackTxt =
          "Consigo te explicar certinho por aqui, mas pra foto eu preciso de um link público (https) pra enviar no WhatsApp. Se quiser, te mando a localização e você vê de perto na loja. A régua é nosso carro chefe: 4 estilos, 200ml cada taça, total 800ml, R$60. Quer ir na Galeria Suíça ou na Galeria Vila Germânica?";
        await sendWhatsAppText(from, fallbackTxt);
        pushMsg(session, "assistant", fallbackTxt);
        return res.sendStatus(200);
      }
    }

    // Atalho: influencer sempre com contato do Kelvim
    if (looksLikeInfluencer(userText)) {
      const txt =
        "Fechamos sim parcerias com influencers 😄\n\nMe manda por aqui:\n- seu @ do Instagram\n- sua cidade\n- a ideia da parceria (o que você quer propor)\n\nE se preferir falar direto com quem cuida disso, chama o Kelvim (parcerias e influencers): +55 35 99189-7704";
      await sendWhatsAppText(from, txt);
      pushMsg(session, "assistant", txt);
      return res.sendStatus(200);
    }

    // Atalho: estorno / Pix / chope não saiu (tom calmo e direto, sem papo técnico)
    if (looksLikeRefundIssue(userText)) {
      const txt =
        "Calma, a gente resolve isso com você agora. 🍻\n\nPra eu te orientar certinho:\n1) Você ainda está perto da SmartTap?\n2) Qual foi o horário aproximado do Pix?\n3) Você consegue mandar um print do comprovante do Pix?\n\nGeralmente o estorno é automático e cai em instantes, mas pode variar de banco pra banco. Me manda essas info que eu já agilizo.";
      await sendWhatsAppText(from, txt);
      pushMsg(session, "assistant", txt);
      return res.sendStatus(200);
    }

    // Resposta geral via IA
    let aiReply = await generateAIReply(session, userText);

    // Fallback ultimo caso: se vier vazio ou muito genérico
    if (!aiReply || aiReply.length < 3) {
      const site = WEBSITE_URL || "";
      aiReply =
        site
          ? `Pra não te passar informação errada, vou te mandar nosso site oficial: ${site}`
          : "Pra não te passar informação errada, me diz rapidinho se você quer saber sobre Galeria Suíça, Vila Germânica ou SmartTap.";
    }

    // Se o modelo falar horários errados da SmartTap, corrige (proteção)
    if (aiReply.toLowerCase().includes("smarttap") && (aiReply.includes("10h") || aiReply.includes("23h") || aiReply.includes("domingo"))) {
      aiReply =
        "A SmartTap funciona 24 horas, todos os dias. Não fecha. 🍻\n\nEla fica na Galeria Itália, Av. Monte Verde, 561. Se você quiser, eu te mando o link do Maps certinho.";
    }

    await sendWhatsAppText(from, aiReply);
    pushMsg(session, "assistant", aiReply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err?.response?.data || err.message);

    // nunca travar o webhook
    return res.sendStatus(200);
  }
});

app.get("/", (_, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
