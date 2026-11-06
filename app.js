"use strict";

const config = window.siteConfig;
const demo = location.protocol === "file:" || (
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("demo")
);
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl) &&
  config.supabasePublishableKey.startsWith("sb_publishable_");
const form = document.querySelector("#letter-form");
const submit = form.querySelector("button");
const writeStatus = document.querySelector("#write-status");
const boardStatus = document.querySelector("#board-status");
const letters = document.querySelector("#letters");
const more = document.querySelector("#more");
const pages = ["home", "write", "board"];
const unavailable = "공개 게시판 연결이 준비 중입니다.";
const demoLetters = [];
const pageSize = 20;
let cursor;
let boardVersion = 0;
let pending;
let justPosted = false;

for (const [field, value] of Object.entries(config.event)) {
  const node = document.getElementById("event-" + field);
  if (node) node.textContent = value;
}

if (demo || !configured) {
  const setup = document.querySelector("#setup");
  setup.textContent = demo
    ? "미리보기입니다. 가상의 이름과 사번으로 시험해 주세요. 편지는 새로고침하면 사라집니다."
    : unavailable;
  setup.hidden = false;
  submit.disabled = !demo;
}

async function api(path, options = {}) {
  const response = await fetch(config.supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Request failed");
  return response;
}

function letterCard(letter) {
  const card = document.createElement("article");
  card.className = "panel letter";
  const heading = document.createElement("h2");
  heading.textContent = letter.title;
  const people = document.createElement("p");
  people.className = "meta";
  people.textContent = "받는 사람 " + letter.recipient;
  const body = document.createElement("p");
  body.className = "body";
  body.textContent = letter.body;
  card.append(heading, people, body);
  return card;
}

async function loadLetters() {
  const version = boardVersion;
  more.disabled = true;
  if (!configured && !demo) {
    boardStatus.textContent = unavailable;
    return;
  }
  boardStatus.textContent = "편지를 불러오는 중입니다.";
  try {
    const query = new URLSearchParams({
      select: "id,recipient,title,body",
      order: "id.desc",
      limit: pageSize + 1
    });
    if (cursor) query.set("id", "lt." + cursor);
    const rows = demo
      ? demoLetters.filter(letter => !cursor || letter.id < cursor).slice(0, pageSize + 1)
      : await (await api("event_letters?" + query)).json();
    if (version !== boardVersion) return;

    const page = rows.slice(0, pageSize);
    letters.append(...page.map(letterCard));
    cursor = page.at(-1)?.id ?? cursor;
    more.textContent = "이전 편지 더 보기";
    more.hidden = rows.length <= pageSize;
    boardStatus.textContent = !cursor ? "아직 올라온 편지가 없습니다."
      : justPosted ? "편지가 게시됐습니다." : "";
    justPosted = false;
  } catch {
    if (version !== boardVersion) return;
    boardStatus.textContent = "편지를 불러오지 못했습니다.";
    more.textContent = "다시 불러오기";
    more.hidden = false;
  } finally {
    if (version === boardVersion) more.disabled = false;
  }
}

function showPage(focus) {
  const hash = location.hash.slice(1);
  const current = pages.includes(hash) ? hash : "home";
  for (const page of pages) {
    document.getElementById(page).hidden = page !== current;
    const link = document.querySelector('nav a[href="#' + page + '"]');
    if (page === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (focus) {
    document.querySelector("#" + current + " h1").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  boardVersion += 1;
  if (current === "board") {
    letters.replaceChildren();
    cursor = undefined;
    more.hidden = true;
    loadLetters();
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const data = Object.fromEntries(
    Array.from(new FormData(form), ([key, value]) => [key, value.trim()])
  );
  if (Object.values(data).some(value => !value)) {
    writeStatus.textContent = "이름, 제목, 편지 내용을 모두 입력해 주세요.";
    return;
  }

  // The employee number has no form name and never enters the request.
  const draft = JSON.stringify(data);
  if (draft !== pending?.draft) pending = { draft, id: crypto.randomUUID() };
  submit.disabled = true;
  writeStatus.textContent = "편지를 올리는 중입니다.";
  try {
    if (demo) {
      demoLetters.unshift({
        id: demoLetters.length + 1,
        recipient: data.recipient,
        title: data.title,
        body: data.body
      });
    } else {
      await api("rpc/post_event_letter", {
        method: "POST",
        body: JSON.stringify({
          p_request_id: pending.id,
          p_sender: data.sender,
          p_recipient: data.recipient,
          p_title: data.title,
          p_body: data.body
        })
      });
    }
    form.reset();
    pending = undefined;
    writeStatus.textContent = "";
    justPosted = true;
    if (location.hash === "#board") showPage(false);
    else location.hash = "board";
  } catch {
    writeStatus.textContent = "게시 결과를 확인하지 못했습니다. 입력을 유지한 채 다시 눌러 주세요.";
  } finally {
    submit.disabled = false;
  }
});

more.addEventListener("click", loadLetters);
window.addEventListener("hashchange", () => showPage(true));
showPage(false);
