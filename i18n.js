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

// Integrations page: Sales Hunter's wording (i18n.js there), adapted where Sales Ops syncs other fields.
(function () {
  var x = {
 "en": {
  "intgSub": "Connect HubSpot and Metabase — configure everything here, no code needed.",
  "intgHubspotSub": "Sync the sales team’s deals, owners and stages into the app.",
  "intgMetabaseSub": "Pull invoice amounts and the Top Zid Stores ranking.",
  "intgNotConfigured": "Not configured",
  "intgConnected": "Connected",
  "intgError": "Error",
  "intgLastSync": "Last synced {when}",
  "intgNeverSynced": "Never synced yet",
  "intgSecAuth": "Authentication",
  "intgSecPipelines": "Pipelines to sync",
  "intgSecFields": "Field mapping",
  "intgTokenHint": "Settings → Integrations → Private Apps. Needs deals read and owners read.",
  "intgPipelinesHint": "Pick every pipeline your sales deals can be in. Deals in these pipelines are synced, whoever owns them.",
  "intgAmountProp": "Deal amount property",
  "intgCloseProp": "Close date property",
  "intgLostProp": "Closed-lost reason property",
  "intgUnqualProp": "Unqualified reason property",
  "intgPipelineSearchPh": "Search pipelines by name or ID…",
  "intgNoPipelineMatch": "No pipeline matches.",
  "intgPipelinesSelected": "{n} pipeline(s) selected. Deals in these are synced.",
  "intgFieldsHint": "Type the internal property name from HubSpot (Settings → Properties). Leave any field blank to skip mapping it.",
  "intgSecretSaved": "Saved ••••{hint} — leave blank to keep it",
  "intgToken": "Private App token",
  "intgMbUrl": "Metabase URL",
  "intgMbKey": "Metabase API key",
  "intgStoresAuto": "Top Zid Stores is ranked straight from the warehouse — no card to configure.",
  "intgSshTitle": "SSH tunnel",
  "intgSshOwnKey": "Use a private key from the data team instead",
  "intgSshGenDone": "Key created. Copy the public key and send it to the data team.",
  "intgSshRegenConfirm": "Create a new key? The old one stops working until the data team adds the new public key.",
  "intgSshRegen": "Create a new key",
  "intgSshCopied": "Public key copied",
  "intgSshCopy": "Copy",
  "intgSshPubHint": "Send this public key to the data team to add to authorized_keys for the SSH username below. It is safe to share.",
  "intgSshGenHint": "We create a key pair on our server. The private key stays encrypted there and is never shown. You get the public key to send to the data team.",
  "intgSshGen": "Create a key",
  "intgSshStep2": "2. Where to connect",
  "intgSshStep1": "1. Our key",
  "intgSshNoKey": "No SSH key yet",
  "intgSshKeyIsSaved": "SSH key saved",
  "intgSshTargetPh": "e.g. http://10.0.1.20:3000",
  "intgSshUserHint": "The account the data team set up on the gateway.",
  "intgSshUserPh": "e.g. tunnel-user",
  "intgSshUser": "SSH username",
  "intgSshPort": "SSH port",
  "intgSshHostHint": "The gateway we log in to. Not the Metabase server.",
  "intgSshHostPh": "e.g. 203.0.113.10",
  "intgSshHost": "SSH gateway address",
  "intgSshOn": "Connect to Metabase through an SSH tunnel",
  "intgSshOnHint": "For a Metabase that only answers inside a private network. The sync logs in to an SSH gateway, which passes the connection on to Metabase.",
  "intgSshTarget": "Metabase address through the gateway (optional)",
  "intgSshTargetHint": "Leave empty to use the Metabase URL above, https included. Fill it in only if the gateway reaches Metabase on a different address.",
  "intgSshKey": "SSH private key",
  "intgSshKeyHint": "Paste the whole private key the data team gave you, including the BEGIN and END lines. It is encrypted and never shown again. Its public half must be in authorized_keys on the SSH host.",
  "intgSshKeySaved": "A key is saved. Leave blank to keep it.",
  "intgSshFp": "SSH host verified as",
  "intgSshFpClear": "Forget",
  "intgSshFpNone": "The SSH host's identity is remembered on the first connection, and any other server is refused after that.",
  "intgSshMissing": "Fill in the SSH gateway address and username, and create a key.",
  "intgSshTargetHttp": "The Metabase address must start with https:// or http://",
  "intgSshKeyBad": "That doesn't look like a private key. It should start with -----BEGIN … PRIVATE KEY-----",
  "intgSshKeyPass": "This key is protected by a passphrase. Ask the data team for a key without one.",
  "intgSaved": "Integration saved.",
  "intgSecurityNote": "🔒 Tokens are encrypted and never shown again — the sync jobs read them securely on the server.",
  "saveChanges": "Save changes",
  "intgSectorProp": "Sector property",
  "intgDealTypeProp": "Deal type property",
  "intgStoreIdProp": "Store ID property",
  "intgStoreIdHint": "Optional: without it, the store ID comes from the deal’s Metabase invoice.",
  "intgCardInv": "Invoices card ID",
  "intgCardInvHint": "A copy of Sales Hunter’s “Sales Hunter Deals Details” without its Sales Hunter filter."
 },
 "ar": {
  "intgSub": "اربط HubSpot وMetabase. كل الإعدادات من هنا بدون برمجة.",
  "intgHubspotSub": "مزامنة صفقات فريق المبيعات ومالكيها ومراحلها إلى التطبيق.",
  "intgMetabaseSub": "جلب مبالغ الفواتير وترتيب أفضل متاجر زد.",
  "intgNotConfigured": "غير مُعد",
  "intgConnected": "متصل",
  "intgError": "خطأ",
  "intgLastSync": "آخر مزامنة {when}",
  "intgNeverSynced": "لم تتم المزامنة بعد",
  "intgSecAuth": "المصادقة",
  "intgSecPipelines": "مسارات المزامنة",
  "intgSecFields": "ربط الحقول",
  "intgTokenHint": "الإعدادات ← التكاملات ← التطبيقات الخاصة. يحتاج صلاحية قراءة الصفقات والمالكين.",
  "intgPipelinesHint": "اختر كل خطوط البيع التي قد تكون فيها صفقات المبيعات. تتم مزامنة صفقات هذه الخطوط أيًا كان مالكها.",
  "intgAmountProp": "خاصية قيمة الصفقة",
  "intgCloseProp": "خاصية تاريخ الإغلاق",
  "intgLostProp": "خاصية سبب الخسارة",
  "intgUnqualProp": "خاصية سبب عدم التأهل",
  "intgPipelineSearchPh": "دوّر على مسار بالاسم أو المعرّف…",
  "intgNoPipelineMatch": "ما فيه مسار مطابق.",
  "intgPipelinesSelected": "اخترت {n} مسار. بنزامن الصفقات اللي فيها.",
  "intgFieldsHint": "اكتب الاسم الداخلي للخاصية من HubSpot (الإعدادات ← الخصائص). خل أي خانة فاضية إذا ما تبي تربطها.",
  "intgSecretSaved": "محفوظ ••••{hint}. خله فاضي إذا ما تبي تغيره",
  "intgToken": "رمز التطبيق الخاص",
  "intgMbUrl": "رابط Metabase",
  "intgMbKey": "مفتاح Metabase API",
  "intgStoresAuto": "ترتيب أفضل متاجر زد يجي مباشرة من مستودع البيانات، ما يحتاج تضبط بطاقة.",
  "intgSshTitle": "نفق SSH",
  "intgSshOwnKey": "استخدم مفتاح خاص من فريق البيانات بدال كذا",
  "intgSshGenDone": "انشأنا المفتاح. انسخ المفتاح العام وأرسله لفريق البيانات.",
  "intgSshRegenConfirm": "تبي تنشئ مفتاح جديد؟ القديم يوقف لين يضيف فريق البيانات المفتاح العام الجديد.",
  "intgSshRegen": "أنشئ مفتاح جديد",
  "intgSshCopied": "انتسخ المفتاح العام",
  "intgSshCopy": "انسخ",
  "intgSshPubHint": "أرسل هذا المفتاح العام لفريق البيانات عشان يضيفونه في authorized_keys لاسم المستخدم تحت. عادي تشاركه.",
  "intgSshGenHint": "ننشئ زوج مفاتيح على خادمنا. المفتاح الخاص يبقى مشفر عندنا وما يتعرض أبداً، وتاخذ المفتاح العام وترسله لفريق البيانات.",
  "intgSshGen": "أنشئ مفتاح",
  "intgSshStep2": "الخطوة 2: وين نتصل",
  "intgSshStep1": "الخطوة 1: مفتاحنا",
  "intgSshNoKey": "ما فيه مفتاح SSH للحين",
  "intgSshKeyIsSaved": "مفتاح SSH محفوظ",
  "intgSshTargetPh": "http://10.0.1.20:3000",
  "intgSshUserHint": "الحساب اللي سواه فريق البيانات على البوابة.",
  "intgSshUserPh": "tunnel-user",
  "intgSshUser": "اسم مستخدم SSH",
  "intgSshPort": "منفذ SSH",
  "intgSshHostHint": "البوابة اللي ندخل عليها، وهي غير خادم Metabase.",
  "intgSshHostPh": "203.0.113.10",
  "intgSshHost": "عنوان بوابة SSH",
  "intgSshOn": "اتصل بـ Metabase عن طريق نفق SSH",
  "intgSshOnHint": "لخادم Metabase الذي لا يستجيب إلا داخل شبكة خاصة. تدخل المزامنة إلى بوابة SSH التي تمرر الاتصال إلى Metabase.",
  "intgSshTarget": "عنوان Metabase عن طريق البوابة (اختياري)",
  "intgSshTargetHint": "خله فاضي عشان نستخدم رابط Metabase اللي فوق، حتى لو https. عبّه بس إذا البوابة توصل لـ Metabase على عنوان ثاني.",
  "intgSshKey": "المفتاح الخاص لـ SSH",
  "intgSshKeyHint": "الصق المفتاح الخاص كامل اللي عطاك إياه فريق البيانات، مع سطري BEGIN و END. ينحفظ مشفر وما يتعرض مرة ثانية. لازم يكون المفتاح العام حقه في authorized_keys على خادم SSH.",
  "intgSshKeySaved": "فيه مفتاح محفوظ. خله فاضي إذا ما تبي تغيره.",
  "intgSshFp": "تم التحقق من خادم SSH:",
  "intgSshFpClear": "انسَه",
  "intgSshFpNone": "نحفظ هوية خادم SSH أول مرة نتصل فيه، وبعدها نرفض أي خادم ثاني.",
  "intgSshMissing": "عبّ عنوان بوابة SSH واسم المستخدم، وأنشئ مفتاح.",
  "intgSshTargetHttp": "عنوان Metabase لازم يبدأ بـ https:// أو http://",
  "intgSshKeyBad": "هذا ما يبين إنه مفتاح خاص. لازم يبدأ بـ -----BEGIN … PRIVATE KEY-----",
  "intgSshKeyPass": "هذا المفتاح محمي بكلمة مرور. اطلب من فريق البيانات مفتاح بدونها.",
  "intgSaved": "انحفظ التكامل.",
  "intgSecurityNote": "🔒 الرموز مشفرة وما تنعرض مرة ثانية. مهام المزامنة تقراها بأمان على الخادم.",
  "saveChanges": "احفظ التغييرات",
  "intgSectorProp": "خاصية القطاع",
  "intgDealTypeProp": "خاصية نوع الصفقة",
  "intgStoreIdProp": "خاصية رقم المتجر",
  "intgStoreIdHint": "اختياري: بدونها يؤخذ رقم المتجر من فاتورة الصفقة في Metabase.",
  "intgCardInv": "رقم سؤال الفواتير",
  "intgCardInvHint": "نسخة من سؤال «Sales Hunter Deals Details» بدون فلتر Sales Hunter."
 }
};
  Object.keys(x.en).forEach(function (k) { SO_STRINGS.en[k] = x.en[k]; });
  Object.keys(x.ar).forEach(function (k) { SO_STRINGS.ar[k] = x.ar[k]; });
})();
function t(key, vars) {
  var s = (SO_STRINGS[SO_LANG] || {})[key] || SO_STRINGS.en[key] || key;
  if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
  return s;
}
setLang(SO_LANG);
