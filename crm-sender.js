// Bulk sending: sequential WhatsApp runner (desktop app / WhatsApp Web) and one-click email via Edge Function.
// Uses globals from index.html: schoolsData, CLOUD, CRMDB, saveState, renderCRM, showToast, escapeHtml,
// buildPersonalizedMessage, buildPersonalizedSubject, getCampaignVideoUrl, getWaMode, setWaMode,
// waPhone, openWhatsappChat; and window.getActiveCampaign / window.onCampaignContact from crm-phase2.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const hasWa = (s) => waPhone(s).length > 8;
  const hasEmail = (s) => /\S+@\S+\.\S+/.test(String(s.email || ''));

  // Recipients: pending schools of the active campaign, otherwise the selected schools
  function recipients(filter) {
    const camp = typeof window.getActiveCampaign === 'function' ? window.getActiveCampaign() : null;
    let list;
    if (camp) {
      list = schoolsData.filter((s) => {
        const t = camp.targets.get(Number(s.id));
        return t && t.status === 'pending';
      });
    } else {
      list = schoolsData.filter((s) => s.selected);
    }
    return { camp, list: list.filter(filter).sort((a, b) => a.id - b.id) };
  }

  window.updateBulkCounts = function () {
    if (!$('bulkWaCount')) return;
    const wa = recipients(hasWa);
    const em = recipients(hasEmail);
    $('bulkWaCount').textContent = String(wa.list.length);
    $('bulkEmailCount').textContent = String(em.list.length);
    $('bulkScopeNote').textContent = wa.camp
      ? 'يُرسل لمدارس الحملة النشطة التي حالتها «لم تُرسل» فقط، فلا تتكرر الرسالة لمدرسة أُرسلت لها.'
      : 'يُرسل لكل المدارس المحددة (✓). لتتبّع النتائج احفظها أولاً كحملة من «إدارة الحملات».';
  };

  // Same side effects as the single WhatsApp/email buttons
  function markContacted(school, channel) {
    if (school.status === 'لم يتم التواصل') {
      school.status = 'تم إرسال عرض';
      saveState();
      renderCRM();
    }
    if (CLOUD) {
      CRMDB.logInteraction({
        school_id: school.id,
        type: channel,
        direction: 'out',
        summary: channel === 'whatsapp' ? 'إرسال رسالة الحملة عبر واتساب (إرسال متتابع)' : 'إرسال بريد الحملة'
      });
    }
    if (typeof window.onCampaignContact === 'function') window.onCampaignContact(school.id);
  }

  // =====================================================================
  // WhatsApp sequential runner
  // =====================================================================
  let queue = [];
  let index = 0;
  let sentCount = 0;
  let opened = false;

  function current() { return queue[index] || null; }

  function renderRunner() {
    const s = current();
    const total = queue.length;
    $('waRunnerCounter').textContent = `${Math.min(index + 1, total)} / ${total}`;
    $('waRunnerBar').style.width = total ? `${Math.round((index / total) * 100)}%` : '0%';
    if (!s) {
      $('waRunnerBody').innerHTML = `
        <div class="text-center py-6 space-y-2">
          <div class="text-3xl">🎉</div>
          <div class="font-bold text-slate-900">انتهى الإرسال</div>
          <div class="text-sm text-slate-600">أُرسلت ${sentCount} رسالة، وتُخطيت ${total - sentCount}.</div>
        </div>`;
      $('waRunnerBar').style.width = '100%';
      ['waRunnerOpen', 'waRunnerSent', 'waRunnerSkip'].forEach((id) => $(id).classList.add('hidden'));
      $('waRunnerStop').textContent = 'إغلاق';
      return;
    }
    $('waRunnerBody').innerHTML = `
      <div class="rounded-xl border border-slate-200 p-3 space-y-1">
        <div class="font-bold text-slate-900">${escapeHtml(s.name)}</div>
        <div class="text-xs text-slate-500">📍 ${escapeHtml(s.zone)} — <span class="font-mono" dir="ltr">+${escapeHtml(waPhone(s))}</span></div>
      </div>
      <pre class="whitespace-pre-wrap text-xs text-slate-800 font-sans leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200 max-h-56 overflow-y-auto">${escapeHtml(buildPersonalizedMessage(s))}</pre>`;
    $('waRunnerOpen').textContent = opened ? '↻ إعادة فتح المحادثة' : '💬 فتح المحادثة';
  }

  function openCurrent() {
    const s = current();
    if (!s) return;
    openWhatsappChat(waPhone(s), buildPersonalizedMessage(s));
    opened = true;
    renderRunner();
  }

  function advance(markSent) {
    const s = current();
    if (!s) return;
    if (markSent) {
      markContacted(s, 'whatsapp');
      sentCount++;
    }
    index++;
    opened = false;
    renderRunner();
    if (current() && $('waRunnerAutoOpen').checked) openCurrent();
  }

  function closeRunner() {
    $('waRunner').classList.add('hidden');
    $('waRunner').classList.remove('flex');
    document.removeEventListener('keydown', onKey);
    if (sentCount) showToast(`تم تسجيل ${sentCount} رسالة واتساب مُرسلة`, '💬');
    window.updateBulkCounts();
  }

  function onKey(e) {
    const t = e.target;
    const typing = t && typeof t.closest === 'function' && t.closest('input, textarea, select');
    if (e.key === 'Enter' && current() && !typing) {
      e.preventDefault();
      advance(true);
    } else if (e.key === 'Escape') {
      closeRunner();
    }
  }

  function startWhatsapp() {
    const { list } = recipients(hasWa);
    if (!list.length) {
      showToast('لا توجد مدارس لديها واتساب في القائمة الحالية', 'ℹ️');
      return;
    }
    queue = list;
    index = 0;
    sentCount = 0;
    opened = false;
    ['waRunnerOpen', 'waRunnerSent', 'waRunnerSkip'].forEach((id) => $(id).classList.remove('hidden'));
    $('waRunnerStop').textContent = '⏹ إيقاف';
    $('waRunner').classList.remove('hidden');
    $('waRunner').classList.add('flex');
    document.addEventListener('keydown', onKey);
    renderRunner();
    openCurrent(); // the click that opened the runner counts as the user gesture
  }

  // =====================================================================
  // Email (one click, server-side)
  // =====================================================================
  async function startEmail() {
    if (!CLOUD) {
      showToast('الإرسال الجماعي بالبريد يحتاج الربط بقاعدة البيانات', 'ℹ️');
      return;
    }
    const { camp, list } = recipients(hasEmail);
    if (!list.length) {
      showToast('لا توجد مدارس لديها بريد إلكتروني في القائمة الحالية', 'ℹ️');
      return;
    }
    if (!confirm(`سيتم إرسال ${list.length} رسالة بريد إلكتروني الآن، كل رسالة مخصصة باسم المدرسة. متابعة؟`)) return;

    const btn = $('btnBulkEmail');
    btn.disabled = true;
    btn.classList.add('opacity-60', 'animate-pulse'); // keep the inner count span intact
    showToast(`⏳ جاري إرسال ${list.length} رسالة بريد...`, '✉️');
    try {
      await CRMDB.syncSchools(schoolsData);
      const videoUrl = getCampaignVideoUrl();
      const promoPage = new URL('promo/', location.href).href;
      const thumb = videoUrl.replace(/\/?$/, '/') === promoPage ? promoPage + 'promo-thumb.jpg' : null;
      const res = await CRMDB.sendCampaignEmails({
        campaignId: camp ? camp.id : null,
        messages: list.map((s) => ({
          school_id: s.id,
          subject: buildPersonalizedSubject(s),
          text: buildPersonalizedMessage(s)
        })),
        video: videoUrl ? { url: videoUrl, thumb } : null
      });
      const ok = (res.results || []).filter((r) => r.ok);
      const failed = (res.results || []).filter((r) => !r.ok);
      // The server logged the emails and updated the campaign; move the sales stage here like WhatsApp does
      ok.forEach((r) => {
        const s = schoolsData.find((x) => x.id === Number(r.school_id));
        if (s && s.status === 'لم يتم التواصل') s.status = 'تم إرسال عرض';
      });
      saveState();
      renderCRM();
      if (camp && document.getElementById('activeCampaignSelect')) {
        document.getElementById('activeCampaignSelect').dispatchEvent(new Event('change'));
      }
      showToast(
        failed.length
          ? `أُرسلت ${ok.length} رسالة، وفشلت ${failed.length}: ${failed[0].error || ''}`
          : `تم إرسال ${ok.length} رسالة بريد بنجاح`,
        failed.length ? '⚠️' : '✉️'
      );
    } catch (err) {
      if (err.notDeployed) {
        alert('خدمة إرسال البريد غير مفعّلة بعد.\n\nاتبع خطوات «إرسال البريد الجماعي» في ملف supabase/SETUP.md لتفعيل الدالة send-campaign-email وربط حساب Brevo.');
      } else {
        showToast('تعذر إرسال البريد: ' + err.message, '⚠️');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
      window.updateBulkCounts();
    }
  }

  // =====================================================================
  function init() {
    const modeSel = $('waModeSelect');
    modeSel.value = getWaMode();
    modeSel.addEventListener('change', () => {
      setWaMode(modeSel.value);
      showToast(modeSel.value === 'desktop'
        ? 'ستُفتح المحادثات في تطبيق واتساب على الكمبيوتر'
        : (modeSel.value === 'web' ? 'ستُفتح المحادثات في تبويب واتساب ويب واحد' : 'ستُفتح المحادثات برابط wa.me'), '💬');
    });
    $('btnBulkWhatsapp').addEventListener('click', startWhatsapp);
    $('btnBulkEmail').addEventListener('click', startEmail);
    $('waRunnerOpen').addEventListener('click', openCurrent);
    $('waRunnerSent').addEventListener('click', () => advance(true));
    $('waRunnerSkip').addEventListener('click', () => advance(false));
    $('waRunnerStop').addEventListener('click', closeRunner);
    $('videoUrlInput').addEventListener('input', () => renderCampaignQueue());
    $('videoAutoAppend').addEventListener('change', () => renderCampaignQueue());
    window.updateBulkCounts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
