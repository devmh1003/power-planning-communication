"use strict";

const config = window.siteConfig;
const entry = document.querySelector("#entry-form");
const ballot = document.querySelector("#ballot-form");
const voteStatus = document.querySelector("#vote-status");
const adminForm = document.querySelector("#admin-form");
const adminStatus = document.querySelector("#admin-status");
const results = document.querySelector("#vote-results");
const signOut = document.querySelector("#sign-out");
const refresh = document.querySelector("#refresh-results");
const first = ballot.elements.first;
const second = ballot.elements.second;
let identity;
let requestId;
let adminToken;

for (const [key, value] of Object.entries(config.event)) {
  const field = document.getElementById("event-" + key);
  if (field) field.textContent = key === "description"
    ? "두 사람에게 투표하고, 각 사람에게 전할 한마디를 남기는 소통행사입니다."
    : value;
}

function showPage() {
  const hash = location.hash.slice(1);
  const target = hash === "admin" ? "admin" : ["vote", "write", "board"].includes(hash) ? "vote" : "home";
  for (const page of document.querySelectorAll("[data-page]")) page.hidden = page.id !== target;
  for (const link of document.querySelectorAll("nav a")) {
    if (link.hash === "#" + target) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.querySelector("#" + target + " h1").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function api(path, body, token) {
  const response = await fetch(config.supabaseUrl + path, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Request failed");
  return response.json();
}

function rpc(name, data, token) {
  return api("/rest/v1/rpc/" + name, data, token);
}

function formValues(form) {
  return Object.fromEntries(Array.from(new FormData(form), ([key, value]) => [key, value.trim()]));
}

function syncOptions() {
  for (const option of first.options) option.disabled = !!option.value && option.value === second.value;
  for (const option of second.options) option.disabled = !!option.value && option.value === first.value;
}

entry.addEventListener("submit", async event => {
  event.preventDefault();
  const button = entry.querySelector("button");
  button.disabled = true;
  voteStatus.textContent = "참여 정보를 확인하는 중입니다.";
  try {
    const { employee, voter } = formValues(entry);
    const entered = { p_employee: employee.toUpperCase(), p_voter: voter };
    const response = await rpc("start_icon_vote", entered);
    if (response.status !== "ready") {
      voteStatus.textContent = response.status === "voted"
        ? "이미 투표한 사번입니다." : "입력하신 이름과 사번 형식을 확인해 주세요.";
      return;
    }
    for (const select of [first, second]) {
      select.replaceChildren(new Option("선택해 주세요", ""));
      for (const candidate of response.candidates) select.add(new Option(candidate.label, candidate.id));
    }
    identity = entered;
    requestId = crypto.randomUUID();
    entry.hidden = true;
    ballot.hidden = false;
    voteStatus.textContent = "";
    first.focus();
  } catch {
    voteStatus.textContent = "투표 화면을 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
  } finally {
    button.disabled = false;
  }
});

first.addEventListener("change", syncOptions);
second.addEventListener("change", syncOptions);
document.querySelector("#back-to-entry").addEventListener("click", () => {
  ballot.reset();
  ballot.hidden = true;
  entry.hidden = false;
  identity = requestId = undefined;
  voteStatus.textContent = "";
  entry.elements.employee.focus();
});

ballot.addEventListener("submit", async event => {
  event.preventDefault();
  const button = ballot.querySelector("button");
  const back = document.querySelector("#back-to-entry");
  const data = formValues(ballot);
  if (data.first === data.second || !data.firstNote || !data.secondNote) {
    voteStatus.textContent = "서로 다른 두 사람을 선택하고 한마디씩 적어 주세요.";
    return;
  }
  button.disabled = back.disabled = true;
  voteStatus.textContent = "투표를 제출하는 중입니다.";
  try {
    const status = await rpc("submit_icon_vote", {
      ...identity, p_request: requestId,
      p_first: Number(data.first), p_second: Number(data.second),
      p_first_note: data.firstNote, p_second_note: data.secondNote
    });
    if (!["accepted", "voted"].includes(status)) throw new Error("Invalid ballot");
    ballot.hidden = true;
    ballot.reset();
    entry.reset();
    identity = requestId = undefined;
    voteStatus.textContent = status === "accepted" ? "투표가 완료되었습니다. 참여해 주셔서 감사합니다." : "이미 투표한 사번입니다.";
    voteStatus.tabIndex = -1;
    voteStatus.focus();
  } catch {
    voteStatus.textContent = "제출을 확인하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.";
  } finally {
    button.disabled = back.disabled = false;
  }
});

function clearAdmin(message) {
  adminToken = undefined;
  adminForm.hidden = false;
  refresh.hidden = signOut.hidden = true;
  results.replaceChildren();
  adminStatus.textContent = message;
}

async function loadResults() {
  const token = adminToken;
  refresh.disabled = true;
  try {
    const rows = await rpc("admin_icon_vote_results", {}, token);
    if (token !== adminToken) return;
    results.replaceChildren();
    for (const row of rows) {
      const group = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = row.label + " · " + row.votes + "표";
      group.append(summary);
      if (row.notes.length) {
        const list = document.createElement("ul");
        for (const note of row.notes) {
          const item = document.createElement("li");
          item.textContent = note;
          list.append(item);
        }
        group.append(list);
      }
      results.append(group);
    }
    adminStatus.textContent = "총 참여 " + rows.reduce((sum, row) => sum + Number(row.votes), 0) / 2 + "명";
  } catch {
    if (token === adminToken) clearAdmin("관리 권한을 확인할 수 없습니다. 다시 로그인해 주세요.");
  } finally {
    refresh.disabled = false;
  }
}

adminForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = adminForm.querySelector("button");
  button.disabled = true;
  try {
    const { email } = formValues(adminForm);
    const password = adminForm.elements.password.value;
    const session = await api("/auth/v1/token?grant_type=password", { email, password });
    if (!session.access_token) throw new Error("Missing session");
    adminToken = session.access_token;
    adminForm.hidden = true;
    refresh.hidden = signOut.hidden = false;
    await loadResults();
  } catch {
    clearAdmin("로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.");
  } finally {
    adminForm.elements.password.value = "";
    button.disabled = false;
  }
});
refresh.addEventListener("click", loadResults);
signOut.addEventListener("click", () => clearAdmin("로그아웃했습니다."));
window.addEventListener("hashchange", showPage);
showPage();
