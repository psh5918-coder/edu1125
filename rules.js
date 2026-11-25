"use strict";

const TravelRules = (() => {
  const dayMs = 86_400_000;
  const dailyRate = 25_000;
  const lodgingCaps = { seoul: 100_000, metro: 80_000, other: 70_000 };
  const regionNames = { seoul: "서울특별시", metro: "광역시", other: "그 밖의 지역" };
  const officialTransport = new Set(["official", "official-other"]);
  const waterOrAir = new Set(["air", "sea", "official-other"]);
  const dateFormat = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const wonFormat = new Intl.NumberFormat("ko-KR");

  function won(amount) {
    return wonFormat.format(amount) + "원";
  }

  function calendarDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
      throw new Error("출장 시작일과 복귀일을 올바르게 입력하세요.");
    }
    const instant = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) {
      throw new Error("출장 시작일과 복귀일을 올바르게 입력하세요.");
    }
    return instant / dayMs;
  }

  function tripDays(start, end) {
    const days = calendarDay(end) - calendarDay(start) + 1;
    if (days < 1) throw new Error("복귀일은 출장 시작일과 같거나 이후여야 합니다.");
    return days;
  }

  function deadline(end, days) {
    return dateFormat.format((calendarDay(end) + days) * dayMs);
  }

  function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (value === "" || value === null || value === undefined) {
      throw new Error(label + "을(를) 입력하세요.");
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
      throw new Error(label + " 입력 범위를 확인하세요.");
    }
    return number;
  }

  function result(summary, rows, notes) {
    return { summary, rows, notes, total: rows.reduce((sum, row) => sum + row[1], 0) };
  }

  function calculateLocal(data, days) {
    if (days !== 1) throw new Error("근무지 내 출장 1일분을 계산하려면 시작일과 복귀일을 같게 설정하세요.");
    const hours = integer(data.hours, "출장 시간", 0, 24);
    const minutes = integer(data.minutes, "출장 분", 0, 59);
    const duration = hours * 60 + minutes;
    if (duration < 1 || duration > 1440) {
      throw new Error("출장시간을 1분 이상 24시간 이하로 입력하세요.");
    }
    const base = duration >= 240 ? 20_000 : 10_000;
    const timeRule = duration >= 240 ? "4시간 이상" : "4시간 미만";
    const notes = ["제18조에 따라 " + timeRule + " 기본 지급액 " + won(base) + "을 적용했습니다."];
    let payable = base;

    if (data.localVehicle === "assigned") {
      payable = 0;
      notes.push("전용 차량 배정 대상은 근무지 내 출장여비를 지급하지 않습니다.");
    } else if (data.localVehicle === "official") {
      payable -= 10_000;
      notes.push("공무용 차량 이용 등으로 10,000원을 감액했습니다.");
    }

    return result("근무지 내 출장 · " + hours + "시간 " + minutes + "분",
      [["근무지 내 출장여비", payable]], notes);
  }

  function dailyAmount(days, longStay) {
    if (!longStay) return days * dailyRate;
    // The arrival date is outside the count that starts the following day.
    const full = Math.min(days, 16);
    const reduced10 = Math.max(0, Math.min(days, 31) - 16);
    const reduced20 = Math.max(0, Math.min(days, 61) - 31);
    const reduced30 = Math.max(0, days - 61);
    return dailyRate / 10 * (full * 10 + reduced10 * 9 + reduced20 * 8 + reduced30 * 7);
  }

  function lodging(data, days) {
    let nights = 0;
    let paid = 0;
    let extraPaid = 0;
    const notes = [];

    for (const stay of data.stays) {
      const count = integer(stay.nights, "숙박일수", 1, Math.max(0, days - 1));
      const rate = integer(stay.rate, "1박 요금", 0, 999_999_999);
      nights += count;
      const cap = data.grade === "2" ? lodgingCaps[stay.region] : null;
      const base = cap === null ? rate : Math.min(rate, cap);
      const extra = cap !== null && stay.extra ? Math.min(rate - base, cap * 0.3) : 0;
      paid += (base + extra) * count;
      extraPaid += extra * count;

      if (cap !== null && rate > cap) {
        const adjustment = extra ? " 및 추가 지급 " + won(extra) : "";
        notes.push(regionNames[stay.region] + " " + count + "박에 1박 상한 " + won(cap) + adjustment + "을 적용했습니다.");
      }
    }
    if (nights >= days) throw new Error("숙박일수 합계는 인정 여행일수보다 작아야 합니다.");
    return { nights, paid, extraPaid, notes };
  }

  function calculateOutside(data, periodDays) {
    if (!["1", "2", "executive"].includes(data.grade)) {
      throw new Error("여비 지급 구분을 선택하세요.");
    }
    const days = data.dayOverride === "" ? periodDays
      : integer(data.dayOverride, "인정 여행일수", 1, periodDays);
    const executive = data.grade === "executive";
    const separateMeals = waterOrAir.has(data.transport);
    const mealDays = executive ? 0 : data.mealDays === "" && !separateMeals ? days
      : integer(data.mealDays, "식비 지급 대상 일수", 0, days);
    const official = officialTransport.has(data.transport);
    const fare = official ? 0 : integer(data.fare, "운임 합계", 0, 999_999_999);
    const stays = lodging(data, days);
    const half = data.transport === "official" || data.half;
    const longStay = !executive && data.longStay;
    const baseDaily = executive ? integer(data.actualDaily, "일비 실비 총액", 0, 999_999_999)
      : dailyAmount(days, longStay);
    const daily = half ? Math.floor(baseDaily / 2) : baseDaily;
    const meals = executive ? integer(data.actualMeals, "식비 실비 총액", 0, 999_999_999)
      : mealDays * dailyRate;
    const notes = [...stays.notes];

    if (official) notes.push("공용 교통수단만 이용하여 운임이 0원입니다.");
    if (half) notes.push("공무용 차량 이용 등으로 일비의 절반을 적용했습니다.");
    if (longStay && days > 16) notes.push("동일 지역 장기 체재로 도착 다음 날부터 15일·30일·60일 초과분에 일비 감액을 적용했습니다.");
    if (!executive && mealDays < days) notes.push("식비 지급 대상 " + mealDays + "일을 반영했습니다.");
    if (data.mode === "settlement") {
      notes.push("운임·숙박비 일반 정산 신청 기한은 " + deadline(data.end, 14) + "입니다.");
      if (stays.extraPaid) notes.push("숙박비 상한 초과분은 " + deadline(data.end, 7) + "까지 증빙을 갖춰 신청합니다.");
    }
    return result("근무지 밖 출장 · " + days + "일 / " + stays.nights + "박",
      [["운임", fare], ["일비", daily], ["숙박비", stays.paid], ["식비", meals]], notes);
  }

  function calculate(data) {
    const days = tripDays(data.start, data.end);
    return data.kind === "local" ? calculateLocal(data, days) : calculateOutside(data, days);
  }

  return { calculate, lodgingCaps, officialTransport, tripDays, waterOrAir, won };
})();

if (typeof module !== "undefined") module.exports = TravelRules;
