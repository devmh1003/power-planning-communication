"use strict";

const config = window.siteConfig;
const entry = document.querySelector("#entry-form");
const ballot = document.querySelector("#ballot-form");
const voteStatus = document.querySelector("#vote-status");
const adminForm = document.querySelector("#admin-form");
const adminStatus = document.querySelector("#admin-status");
const results = document.querySelector("#vote-results");
const management = document.querySelector("#ballot-management");
const managementStatus = document.querySelector("#ballot-management-status");
const adminBallots = document.querySelector("#admin-ballots");
const resetDetails = document.querySelector("#reset-results");
const resetForm = document.querySelector("#reset-results-form");
const resetStatus = document.querySelector("#reset-status");
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
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw Object.assign(new Error("Request failed"), { status: response.status, code: detail?.code });
  }
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
  management.hidden = true;
  resetDetails.hidden = true;
  resetDetails.open = false;
  resetForm.reset();
  resetStatus.textContent = "";
  adminBallots.replaceChildren();
  managementStatus.textContent = "";
  adminStatus.textContent = message;
}

async function loadResults() {
  const token = adminToken;
  refresh.disabled = true;
  try {
    const [rows, ballots] = await Promise.all([
      rpc("admin_icon_vote_results", {}, token),
      rpc("admin_icon_ballots", {}, token)
    ]);
    if (token !== adminToken) return;
    const heading = document.createElement("h2");
    heading.textContent = "전체 득표 순위";
    results.replaceChildren(heading);
    const frequencies = new Map();
    for (const row of rows) frequencies.set(row.votes, (frequencies.get(row.votes) ?? 0) + 1);
    let rank = 1;
    for (const [index, row] of rows.entries()) {
      if (index && row.votes !== rows[index - 1].votes) rank = index + 1;
      const group = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = (frequencies.get(row.votes) > 1 ? "공동 " : "") + rank + "위 · " + row.label + " · " + row.votes + "표";
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
    adminStatus.textContent = "총 참여 " + ballots.length + "명";
    adminBallots.replaceChildren(...ballots.map(ballot => ballotEditor(ballot, rows)));
    if (!ballots.length) adminBallots.textContent = "아직 제출된 투표가 없습니다.";
    management.hidden = false;
    resetDetails.hidden = false;
  } catch {
    if (token === adminToken) clearAdmin("관리 권한을 확인할 수 없습니다. 다시 로그인해 주세요.");
  } finally {
    refresh.disabled = false;
  }
}

function ballotEditor(record, candidates) {
  const group = document.createElement("details");
  const summary = document.createElement("summary");
  const names = new Map(candidates.map(candidate => [candidate.id, candidate.label]));
  summary.textContent = names.get(record.first_id) + " · " + names.get(record.second_id);
  const form = document.createElement("form");
  for (const [slot, caption] of [["first", "첫 번째 선택"], ["second", "두 번째 선택"]]) {
    const choice = document.createElement("select");
    choice.name = slot;
    for (const candidate of candidates) choice.add(new Option(candidate.label, candidate.id));
    choice.value = record[slot + "_id"];
    const note = document.createElement("textarea");
    note.name = slot + "Note";
    note.rows = 2;
    note.maxLength = 100;
    note.required = true;
    const choiceLabel = document.createElement("label");
    choiceLabel.append(caption, choice);
    const noteLabel = document.createElement("label");
    noteLabel.append(caption + " 한마디", note);
    note.value = record[slot + "_note"];
    form.append(choiceLabel, noteLabel);
  }
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const save = document.createElement("button");
  save.className = "button";
  save.textContent = "변경 저장";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "투표 삭제";
  actions.append(save, remove);
  form.append(actions);
  group.append(summary, form);

  async function change(deleting) {
    const data = formValues(form);
    if (!deleting && (data.first === data.second || !data.firstNote || !data.secondNote)) {
      managementStatus.textContent = "서로 다른 두 사람을 선택하고 한마디씩 입력해 주세요.";
      return;
    }
    const token = adminToken;
    if (!token) return;
    save.disabled = remove.disabled = refresh.disabled = true;
    try {
      const changed = await rpc("admin_icon_ballot_change", {
        p_id: record.ballot_id, p_delete: deleting,
        p_first: deleting ? null : Number(data.first), p_second: deleting ? null : Number(data.second),
        p_first_note: deleting ? null : data.firstNote, p_second_note: deleting ? null : data.secondNote
      }, token);
      if (!changed) throw new Error("Ballot missing or invalid");
      if (adminToken !== token) return;
      managementStatus.textContent = deleting ? "투표를 삭제했습니다." : "변경사항을 저장했습니다.";
      await loadResults();
    } catch {
      if (adminToken === token) managementStatus.textContent = "변경하지 못했습니다. 투표 상태를 확인하고 다시 시도해 주세요.";
    } finally {
      save.disabled = remove.disabled = refresh.disabled = false;
    }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    change(false);
  });
  remove.addEventListener("click", () => {
    if (window.confirm("이 제출 건의 두 표와 한마디를 모두 삭제할까요? 삭제한 사번은 다시 투표할 수 있습니다.")) change(true);
  });
  return group;
}

resetForm.addEventListener("submit", async event => {
  event.preventDefault();
  const token = adminToken;
  const confirmation = resetForm.elements.confirmation.value.trim().replace(/\s+/g, " ");
  const button = resetForm.querySelector("button");
  if (!token || button.disabled) return;
  if (confirmation !== "결과 초기화") {
    resetStatus.textContent = "확인 문구에 ‘결과 초기화’를 입력해 주세요.";
    resetForm.elements.confirmation.focus();
    return;
  }
  button.disabled = refresh.disabled = true;
  resetStatus.textContent = "초기화 중입니다.";
  try {
    const removed = await rpc("admin_icon_vote_reset", { p_confirmation: confirmation }, token);
    if (token !== adminToken) return;
    resetForm.reset();
    resetDetails.open = false;
    await loadResults();
    if (token !== adminToken) return;
    resetStatus.textContent = "초기화 완료 · 삭제된 투표 " + removed + "건";
    resetStatus.focus();
  } catch (error) {
    if (token !== adminToken) return;
    resetStatus.textContent = [401, 403].includes(error.status) || error.code === "42501"
      ? "관리자 권한을 확인할 수 없습니다. 로그아웃한 뒤 다시 로그인해 주세요."
      : "초기화 결과를 확인하지 못했습니다. 결과를 새로고침해 확인해 주세요.";
    resetStatus.focus();
  } finally {
    button.disabled = refresh.disabled = false;
  }
});

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
