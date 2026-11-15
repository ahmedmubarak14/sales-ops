/* ============================================================
   Sales Ops Portal: language (English / Arabic, RTL)
   App copy is written inline as L('English', 'عربي'); the keyed
   strings below serve the shared chart and date-picker modules
   copied from Sales Hunter (charts.js, daterange.js).
   ============================================================ */

var SO_LANG = (function () { try { return JSON.parse(localStorage.getItem('so.lang')) || 'en'; } catch (e) { return 'en'; } })();
function isAr() { return SO_LANG === 'ar'; }
function setLang(l) {
  SO_LANG = l;
  try { localStorage.setItem('so.lang', JSON.stringify(l)); } catch (e) {}
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
}
function L(en, ar) { return isAr() && ar ? ar : en; }

var NO_REASON_KEY = '__none__';
function trReason(k) { return k; }

var SO_STRINGS = {
  en: {
    noData: 'No data yet', dataBtn: 'Data', chartBtn: 'Chart', emptyReasons: 'Nothing to show yet',
    noReasonGiven: 'No reason given', noReasonsYet: 'Nothing yet',
    leadsUnit: 'deals', leadsReached: '{n} deals', ofPrevStage: '{pct} of the previous stage', leadsPct: '{n} deals · {pct}',
    dateFrom: 'From', dateTo: 'To', dpToday: 'Today', drpApply: 'Apply', drpCancel: 'Cancel',
    drpDialogLabel: 'Choose a date range', drpFieldHint: 'dd/mm/yyyy', drpFromOnly: 'From {d}', drpToOnly: 'Until {d}',
    drpNextMonth: 'Next month', drpPrevMonth: 'Previous month', drpPresetsLabel: 'Presets', rangeAll: 'All time'
  },
  ar: {
    noData: 'لا توجد بيانات بعد', dataBtn: 'البيانات', chartBtn: 'الرسم', emptyReasons: 'لا يوجد ما يُعرض بعد',
    noReasonGiven: 'بدون سبب', noReasonsYet: 'لا شيء بعد',
    leadsUnit: 'صفقة', leadsReached: '{n} صفقة', ofPrevStage: '{pct} من المرحلة السابقة', leadsPct: '{n} صفقة · {pct}',
    dateFrom: 'من', dateTo: 'إلى', dpToday: 'اليوم', drpApply: 'تطبيق', drpCancel: 'إلغاء',
    drpDialogLabel: 'اختر فترة', drpFieldHint: 'يوم/شهر/سنة', drpFromOnly: 'من {d}', drpToOnly: 'حتى {d}',
    drpNextMonth: 'الشهر التالي', drpPrevMonth: 'الشهر السابق', drpPresetsLabel: 'فترات جاهزة', rangeAll: 'كل الفترات'
  }
};
function t(key, vars) {
  var s = (SO_STRINGS[SO_LANG] || {})[key] || SO_STRINGS.en[key] || key;
  if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
  return s;
}
setLang(SO_LANG);
