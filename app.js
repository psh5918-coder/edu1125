"use strict";

const form = document.querySelector("#trip-form");
const fields = form.elements;
const stays = document.querySelector("#stays");
const stayTemplate = document.querySelector("#stay-template");
const period = document.querySelector("#period");
const error = document.querySelector("#error");
const total = document.querySelector("#total");
const summary = document.querySelector("#result-summary");
const tripDetails = document.querySelector("#trip-details");
const breakdown = document.querySelector("#breakdown");
const notes = document.querySelector("#notes");
const printResult = document.querySelector("#print-result");
const saveExcel = document.querySelector("#save-excel");
const exportError = document.querySelector("#export-error");
const resultTitle = document.querySelector("#result-title");
const helpDialog = document.querySelector("#help-dialog");
let exportData = null;

document.querySelector("#show-help").addEventListener("click", () => {
  helpDialog.showModal();
});

function toggleGroup(id, visible) {
  const group = document.getElementById(id);
  group.hidden = !visible;
  for (const control of group.querySelectorAll("input, select")) {
    control.disabled = !visible;
  }
}

function updatePeriod() {
  period.hidden = true;
  fields.end.min = fields.start.value;
  fields.end.setCustomValidity("");
  if (!fields.start.value || !fields.end.value) return;

  try {
    const days = TravelRules.tripDays(fields.start.value, fields.end.value);
    period.textContent = "날짜 기준 출장 기간 " + days + "일";
    period.hidden = false;
    fields.dayOverride.max = String(days);
  } catch (problem) {
    fields.end.setCustomValidity(problem.message);
  }
}

function updateForm() {
  const local = fields.kind.value === "local";
  const executive = fields.grade.value === "executive";
  const settlement = fields.mode.value === "settlement";
  const transport = fields.transport.value;
  const separatelyCountedMeals = TravelRules.waterOrAir.has(transport);
  document.querySelector("#local-fields").hidden = !local;
  document.querySelector("#local-fields").disabled = !local;
  document.querySelector("#outside-fields").hidden = local;
  document.querySelector("#outside-fields").disabled = local;
  toggleGroup("fare-row", !TravelRules.officialTransport.has(transport));
  toggleGroup("executive-row", executive);
  toggleGroup("half-row", transport !== "official");
  toggleGroup("long-row", !executive);
  fields.mealDays.closest("label").hidden = executive;
  fields.mealDays.disabled = executive;
  fields.mealDays.required = separatelyCountedMeals && !executive;
  fields.mealDays.placeholder = separatelyCountedMeals ? "지급 대상 일수 입력" : "인정 여행일수 전체";
  document.querySelector("#meal-hint").textContent = separatelyCountedMeals
    ? "식비 지급 대상 일수에는 육로 출장일과 선박·항공 여행 중 별도 식비가 필요한 날을 포함하세요."
    : "실제 필요한 여행일수가 날짜 기준 기간과 다르면 인정 여행일수를 입력하세요.";
  resultTitle.textContent = settlement ? "정산 지급액" : "예상 지급액";

  let fareLabel = settlement ? "정산 대상 운임 합계 (원)" : "예상 운임 합계 (원)";
  let fareHint = "운임을 할인받을 수 있다면 할인 요금을 입력하세요.";
  if (transport === "private") {
    fareLabel = "해당 철도·버스 운임 합계 (원)";
  } else if (transport === "private-exception") {
    fareLabel = "인정 연료비·통행료 등 합계 (원)";
    fareHint = "공무상 부득이한 자가용 이용으로 인정된 금액을 입력하세요.";
  } else if (transport === "land" || transport === "sea") {
    const classes = transport === "land" ? "철도는 제1호 특실·제2호 일반실" : "선박은 제1호 1등급·제2호 2등급";
    fareHint += " " + classes + " 기준입니다.";
  }
  document.querySelector("#fare-label").textContent = fareLabel;
  document.querySelector("#fare-hint").textContent = fareHint;

  for (const stay of stays.children) {
    const extra = stay.querySelector(".exception");
    extra.hidden = fields.grade.value !== "2";
    extra.querySelector("input").disabled = extra.hidden;
  }
  updatePeriod();
}

function clearResult() {
  total.textContent = "—";
  summary.textContent = "출장 정보를 입력하고 여비를 계산해 보세요.";
  tripDetails.replaceChildren();
  tripDetails.hidden = true;
  breakdown.replaceChildren();
  notes.replaceChildren();
  notes.hidden = true;
  printResult.disabled = true;
  saveExcel.disabled = true;
  exportData = null;
  exportError.hidden = true;
  error.hidden = true;
}

function renderRows(list, rows) {
  for (const [label, text] of rows) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = label;
    value.textContent = text;
    row.append(term, value);
    list.append(row);
  }
}

function renumberStays() {
  Array.from(stays.children).forEach((stay, index) => {
    const label = "숙박 내역 " + (index + 1);
    stay.querySelector(".stay-title").textContent = label;
    stay.querySelector(".remove-stay").setAttribute("aria-label", label + " 삭제");
  });
}

const addStay = document.querySelector("#add-stay");
addStay.addEventListener("click", () => {
  const stay = stayTemplate.content.firstElementChild.cloneNode(true);
  stays.append(stay);
  renumberStays();
  updateForm();
  clearResult();
  stay.querySelector("select").focus();
});

stays.addEventListener("click", (event) => {
  const remove = event.target.closest(".remove-stay");
  if (!remove) return;
  const stay = remove.closest(".stay");
  const nextFocus = stay.nextElementSibling?.querySelector(".remove-stay")
    ?? stay.previousElementSibling?.querySelector(".remove-stay") ?? addStay;
  stay.remove();
  renumberStays();
  clearResult();
  nextFocus.focus();
});

form.addEventListener("input", () => {
  updateForm();
  clearResult();
});

form.addEventListener("reset", () => {
  stays.replaceChildren();
  queueMicrotask(() => {
    updateForm();
    clearResult();
  });
});

function readTrip() {
  const data = Object.fromEntries(new FormData(form));
  data.half = fields.half.checked && !fields.half.disabled;
  data.longStay = fields.longStay.checked && !fields.longStay.disabled;
  data.stays = Array.from(stays.children, (stay) => ({
    region: stay.querySelector('[data-field="region"]').value,
    nights: stay.querySelector('[data-field="nights"]').value,
    rate: stay.querySelector('[data-field="rate"]').value,
    extra: stay.querySelector('[data-field="extra"]').checked,
  }));
  return data;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearResult();

  try {
    const trip = readTrip();
    const result = TravelRules.calculate(trip);
    total.textContent = TravelRules.won(result.total);
    summary.textContent = result.summary;
    const details = [
      ["출장 시작일", trip.start],
      ["복귀일", trip.end],
    ];
    if (trip.kind === "local") {
      details.push(["차량 사용", fields.localVehicle.selectedOptions[0].textContent]);
    } else {
      details.push(
        ["여비 지급 구분", fields.grade.selectedOptions[0].textContent],
        ["교통수단", fields.transport.selectedOptions[0].textContent],
      );
    }
    renderRows(tripDetails, details);
    tripDetails.hidden = false;
    renderRows(breakdown, result.rows.map(([label, amount]) => [label, TravelRules.won(amount)]));
    for (const message of result.notes) {
      const note = document.createElement("li");
      note.textContent = message;
      notes.append(note);
    }
    notes.hidden = result.notes.length === 0;
    exportData = {
      ...result,
      start: trip.start,
      end: trip.end,
      totalLabel: resultTitle.textContent,
      details,
      basis: document.querySelector("#rule-basis").textContent,
    };
    saveExcel.disabled = false;
    printResult.disabled = false;
  } catch (problem) {
    error.hidden = false;
    error.textContent = problem.message;
  }
});

printResult.addEventListener("click", () => {
  if (!printResult.disabled) window.print();
});

saveExcel.addEventListener("click", () => {
  if (!exportData) return;
  exportError.hidden = true;
  try {
    TravelExcel.download(exportData);
  } catch {
    exportError.textContent = "엑셀 파일을 만들지 못했습니다. 다시 시도해 주세요.";
    exportError.hidden = false;
  }
});

updateForm();
