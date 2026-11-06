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
const previous = document.querySelector("#previous");
const boardPage = document.querySelector("#board-page");
const pages = ["home", "write", "board", "admin"];
const unavailable = "공개 게시판 연결이 준비 중입니다.";
const demoLetters = [];
const pageSize = 20;
const boardPageSize = 9;
let boardCursors = [null];
let boardIndex = 0;
let boardVersion = 0;
let pending;
let justPosted = false;
let demoId = 0;
let adminToken;
let adminCursor;
let adminVersion = 0;
let editTarget;
const demoKeys = new Map();
const adminForm = document.querySelector("#admin-form");
const adminStatus = document.querySelector("#admin-status");
const adminLetters = document.querySelector("#admin-letters");
const adminMore = document.querySelector("#admin-more");
const signOut = document.querySelector("#sign-out");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const editStatus = document.querySelector("#edit-status");

function ownerKey(id) {
  if (demo) return demoKeys.get(id);
  try { return localStorage.getItem("event-letter:" + id); }
  catch { return null; }
}

function rpc(name, args, token) {
  return api("rpc/" + name, { method: "POST", body: JSON.stringify(args) }, token)
    .then(response => response.json());
}

for (const [field, value] of Object.entries(config.event)) {
  const node = document.getElementById("event-" + field);
  if (node) node.textContent = value;
}

if (!configured && !demo) {
  submit.disabled = true;
}

async function api(path, options = {}, token, base = "/rest/v1/") {
  const response = await fetch(config.supabaseUrl + base + path, {
    ...options,
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Request failed");
  return response;
}

function letterCard(letter, admin = false) {
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
  if (admin) people.textContent += " · 보내는 사람 " + letter.sender;
  const key = ownerKey(letter.id);
  if (admin || key) {
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const edit = actionButton("수정", () => openEditor(letter, admin, key));
    const remove = actionButton("삭제", async () => {
      if (!window.confirm("이 편지를 삭제할까요?")) return;
      edit.disabled = remove.disabled = true;
      const status = admin ? adminStatus : boardStatus;
      try {
        await changeLetter(letter.id, admin, key, true, {});
        card.remove();
        status.textContent = "편지를 삭제했습니다.";
      } catch {
        status.textContent = "삭제할 수 없습니다. 권한과 연결 상태를 확인해 주세요.";
      } finally {
        edit.disabled = remove.disabled = false;
      }
    });
    actions.append(edit, remove);
    card.append(actions);
  }
  return card;
}

async function loadLetters(index = 0) {
  const version = boardVersion;
  const cursor = boardCursors[index];
  more.disabled = previous.disabled = true;
  if (!configured && !demo) {
    boardStatus.textContent = unavailable;
    return;
  }
  boardStatus.textContent = "편지를 불러오는 중입니다.";
  try {
    const query = new URLSearchParams({
      select: "id,recipient,title,body",
      order: "id.desc",
      limit: boardPageSize + 1
    });
    if (cursor) query.set("id", "lt." + cursor);
    const rows = demo
      ? demoLetters.filter(letter => !cursor || letter.id < cursor).slice(0, boardPageSize + 1)
      : await (await api("event_letters?" + query)).json();
    if (version !== boardVersion) return;

    const page = rows.slice(0, boardPageSize);
    letters.replaceChildren(...page.map(letter => letterCard(letter)));
    boardIndex = index;
    boardCursors.length = index + 1;
    if (rows.length > boardPageSize) boardCursors.push(page.at(-1).id);
    previous.hidden = index === 0;
    more.hidden = rows.length <= boardPageSize;
    more.textContent = "이전 편지 →";
    boardPage.hidden = previous.hidden && more.hidden;
    boardPage.textContent = (index + 1) + " 페이지";
    boardStatus.textContent = !page.length
      ? index ? "이 페이지에 남아 있는 편지가 없습니다." : "아직 올라온 편지가 없습니다."
      : justPosted ? "편지가 게시됐습니다." : "";
    justPosted = false;
  } catch {
    if (version !== boardVersion) return;
    boardStatus.textContent = "편지를 불러오지 못했습니다.";
    if (!letters.children.length && index === 0) {
      more.textContent = "다시 불러오기";
      more.hidden = false;
    }
  } finally {
    if (version === boardVersion) more.disabled = previous.disabled = false;
  }
}

function showPage(focus) {
  const hash = location.hash.slice(1);
  const current = pages.includes(hash) ? hash : "home";
  for (const page of pages) {
    document.getElementById(page).hidden = page !== current;
    const link = document.querySelector('nav a[href="#' + page + '"]');
    if (!link) continue;
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
    boardCursors = [null];
    boardIndex = 0;
    more.hidden = previous.hidden = boardPage.hidden = true;
    loadLetters();
  }
  if (current === "admin" && adminToken) refreshAdmin();
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
  if (draft !== pending?.draft) pending = { draft, id: crypto.randomUUID(), key: crypto.randomUUID() };
  submit.disabled = true;
  writeStatus.textContent = "편지를 올리는 중입니다.";
  try {
    if (demo) {
      demoId += 1;
      demoKeys.set(demoId, pending.key);
      demoLetters.unshift({
        id: demoId,
        recipient: data.recipient,
        title: data.title,
        body: data.body
      });
    } else {
      // Check that this browser can retain the author key before posting.
      const probe = "event-pending:" + pending.id;
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      const id = await rpc("post_event_letter", {
        p_request_id: pending.id,
        p_owner_key: pending.key,
        p_sender: data.sender,
        p_recipient: data.recipient,
        p_title: data.title,
        p_body: data.body
      });
      if (!id) throw new Error("Missing letter ID");
      localStorage.setItem("event-letter:" + id, pending.key);
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

function actionButton(label, handler) {
  const button = document.createElement("button");
  button.className = "secondary";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function changeLetter(id, admin, key, remove, data) {
  if (demo) {
    const index = demoLetters.findIndex(letter => letter.id === id);
    if (index < 0 || demoKeys.get(id) !== key) throw new Error("Unauthorized");
    if (remove) {
      demoLetters.splice(index, 1);
      demoKeys.delete(id);
    } else Object.assign(demoLetters[index], data);
    return;
  }
  if (!await rpc("manage_event_letter", {
    p_id: id,
    p_owner_key: admin ? null : key,
    p_delete: remove,
    p_recipient: data.recipient ?? null,
    p_title: data.title ?? null,
    p_body: data.body ?? null
  }, admin ? adminToken : undefined)) throw new Error("Unauthorized");
}

function openEditor(letter, admin, key) {
  editTarget = { letter, admin, key };
  for (const name of ["recipient", "title", "body"]) editForm.elements[name].value = letter[name];
  editStatus.textContent = "";
  editDialog.showModal();
}

const editSave = editForm.querySelector("button[type=submit], button:not([type])");
document.querySelector("#edit-cancel").addEventListener("click", () => editDialog.close());
editForm.addEventListener("submit", async event => {
  event.preventDefault();
  const { letter, admin, key } = editTarget;
  const data = Object.fromEntries(Array.from(new FormData(editForm), ([name, value]) => [name, value.trim()]));
  if (Object.values(data).some(value => !value)) {
    editStatus.textContent = "받는 사람, 제목, 편지 내용을 모두 입력해 주세요.";
    return;
  }
  editSave.disabled = true;
  try {
    await changeLetter(letter.id, admin, key, false, data);
    editDialog.close();
    if (admin && adminToken) refreshAdmin();
    else if (location.hash === "#board") showPage(false);
  } catch {
    editStatus.textContent = "수정할 수 없습니다. 권한과 연결 상태를 확인해 주세요.";
  } finally {
    editSave.disabled = false;
  }
});

async function loadAdmin() {
  const version = adminVersion;
  adminMore.disabled = true;
  try {
    const rows = await rpc("admin_event_letters", { p_before: adminCursor ?? null }, adminToken);
    if (version !== adminVersion) return;
    const page = rows.slice(0, pageSize);
    adminLetters.append(...page.map(letter => letterCard(letter, true)));
    adminCursor = page.at(-1)?.id ?? adminCursor;
    adminMore.hidden = rows.length <= pageSize;
    adminStatus.textContent = adminCursor ? "" : "아직 올라온 편지가 없습니다.";
  } catch {
    if (version !== adminVersion) return;
    clearAdmin("관리 권한을 확인할 수 없습니다. 관리자 계정으로 다시 로그인해 주세요.");
  } finally {
    if (version === adminVersion) adminMore.disabled = false;
  }
}

function refreshAdmin() {
  adminVersion += 1;
  adminCursor = undefined;
  adminLetters.replaceChildren();
  adminMore.hidden = true;
  loadAdmin();
}

function clearAdmin(message) {
  adminVersion += 1;
  adminToken = undefined;
  adminLetters.replaceChildren();
  adminForm.hidden = false;
  signOut.hidden = adminMore.hidden = true;
  adminStatus.textContent = message;
}

const adminSubmit = adminForm.querySelector("button");
if (!configured || demo) {
  adminSubmit.disabled = true;
  adminStatus.textContent = "관리자 모드는 데이터베이스 연결 후 사용할 수 있습니다.";
}
adminForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (adminSubmit.disabled) return;
  adminSubmit.disabled = true;
  const { email, password } = Object.fromEntries(new FormData(adminForm));
  try {
    const response = await api("token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email, password })
    }, undefined, "/auth/v1/");
    adminToken = (await response.json()).access_token;
    if (!adminToken) throw new Error("Missing session");
    adminForm.hidden = true;
    signOut.hidden = false;
    refreshAdmin();
  } catch {
    clearAdmin("로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.");
  } finally {
    adminForm.elements.password.value = "";
    adminSubmit.disabled = false;
  }
});
signOut.addEventListener("click", () => {
  const token = adminToken;
  clearAdmin("로그아웃했습니다.");
  if (token) api("logout", { method: "POST" }, token, "/auth/v1/").catch(() => {});
});
adminMore.addEventListener("click", loadAdmin);
more.addEventListener("click", () => loadLetters(
  more.textContent === "다시 불러오기" ? 0 : boardIndex + 1
));
previous.addEventListener("click", () => loadLetters(boardIndex - 1));
window.addEventListener("hashchange", () => showPage(true));
showPage(false);
