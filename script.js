(function () {
  'use strict';

  var C = window.INVITE || {};
  var $ = function (id) { return document.getElementById(id); };

  // ── Память браузера (только для удобства гостя) ──────────────
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var token = store.get('inv_token');
  if (!token) {
    token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    store.set('inv_token', token);
  }

  // ── Тексты из настроек ───────────────────────────────────────
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
    'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var day = C.day || 28, month = C.month || 9;
  var timeMatch = /^(\d{1,2}):(\d{2})$/.exec(C.time || '');

  // ближайшая дата праздника (в сам день считается «сегодня»)
  function eventDate() {
    var now = new Date();
    var y = now.getFullYear();
    var endOfDay = new Date(y, month - 1, day, 23, 59, 59);
    if (now > endOfDay) y += 1;
    return new Date(y, month - 1, day, timeMatch ? +timeMatch[1] : 0, timeMatch ? +timeMatch[2] : 0);
  }
  var target = eventDate();
  var weekday = target.toLocaleDateString('ru-RU', { weekday: 'long' });

  $('greeting').textContent = C.greeting || '';
  $('weekday').textContent = ' · ' + weekday;
  $('whenValue').textContent = day + ' ' + MONTHS[month - 1];
  $('whenSub').textContent = weekday + (C.time ? ', начало в ' + C.time : ' · время сообщу позже');

  $('whereValue').textContent = C.place || 'Место сообщу позже';
  var whereSub = $('whereSub');
  if (C.address) whereSub.textContent = C.address;
  if (C.mapLink) {
    if (C.address) whereSub.appendChild(document.createTextNode(' · '));
    var map = document.createElement('a');
    map.href = C.mapLink; map.target = '_blank'; map.rel = 'noopener';
    map.textContent = 'Открыть карту';
    whereSub.appendChild(map);
  }

  if (C.note) { $('noteValue').textContent = C.note; $('noteFact').hidden = false; }
  if (C.hostName) { $('sign').textContent = C.hostName; $('sign').hidden = false; }

  // ── Обратный отсчёт ──────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var diff = target - new Date();
    if (diff <= 0) {
      $('countdown').hidden = true;
      $('todayMsg').hidden = false;
      return;
    }
    var s = Math.floor(diff / 1000);
    $('cdDays').textContent = Math.floor(s / 86400);
    $('cdHours').textContent = pad(Math.floor(s % 86400 / 3600));
    $('cdMins').textContent = pad(Math.floor(s % 3600 / 60));
    $('cdSecs').textContent = pad(s % 60);
    setTimeout(tick, 1000);
  }
  tick();

  // ── Появление при прокрутке ──────────────────────────────────
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }) : null;

  function watch(el, delay) {
    if (delay) el.style.setProperty('--rd', delay + 'ms');
    if (io) io.observe(el); else el.classList.add('in');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) { watch(el); });

  // ── Связь с таблицей (или демо-режим без неё) ────────────────
  var remote = !!C.apiUrl;
  $('demoBanner').hidden = remote;

  function demoDb() { return store.get('inv_demo') || { claims: {} }; }
  function demoState(db) {
    var ids = Object.keys(db.claims);
    return { ok: true, claimed: ids, mine: ids.filter(function (id) { return db.claims[id] === token; }) };
  }

  var api = {
    state: function () {
      if (!remote) return Promise.resolve(demoState(demoDb()));
      return fetch(C.apiUrl + '?token=' + encodeURIComponent(token) + '&t=' + Date.now())
        .then(function (r) { return r.json(); });
    },
    send: function (body) {
      body.token = token;
      if (!remote) {
        var db = demoDb(), res;
        if (body.action === 'claim') {
          if (db.claims[body.giftId] && db.claims[body.giftId] !== token) res = { ok: false, error: 'taken' };
          else db.claims[body.giftId] = token;
        } else if (body.action === 'unclaim') {
          if (db.claims[body.giftId] === token) delete db.claims[body.giftId];
        }
        store.set('inv_demo', db);
        var st = demoState(db);
        if (res) { st.ok = false; st.error = res.error; }
        return new Promise(function (resolve) { setTimeout(function () { resolve(st); }, 350); });
      }
      // text/plain — чтобы браузер не делал предварительный запрос, который Apps Script не принимает
      return fetch(C.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); });
    }
  };

  // ── Виш-лист ─────────────────────────────────────────────────
  var gifts = C.wishlist || [];
  var giftsEl = $('gifts');
  var giftStatus = $('giftStatus');
  var state = { claimed: [], mine: [] };
  var stateKey = '';
  var askId = null;      // карточка, где сейчас спрашиваем имя
  var busyId = null;     // карточка, по которой идёт запрос
  var askDraft = '';
  var firstRender = true;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyState(res) {
    if (!res || !res.claimed) return false;
    var key = JSON.stringify([res.claimed.slice().sort(), (res.mine || []).slice().sort()]);
    state = { claimed: res.claimed, mine: res.mine || [] };
    if (key === stateKey) return false;
    stateKey = key;
    return true;
  }

  function renderGifts(popId) {
    giftsEl.textContent = '';
    gifts.forEach(function (g, i) {
      var mine = state.mine.indexOf(g.id) !== -1;
      var taken = !mine && state.claimed.indexOf(g.id) !== -1;
      var li = el('li', 'gift ' + (mine ? 'is-mine' : taken ? 'is-taken' : 'is-free'));
      if (firstRender) { li.classList.add('reveal'); watch(li, (i % 3) * 90); }
      if (popId === g.id) li.classList.add('pop');

      var body = el('div', 'gift-body');
      body.appendChild(el('h3', 'gift-title', g.title));
      if (g.note) body.appendChild(el('p', 'gift-note', g.note));
      if (g.link && /^https?:\/\//i.test(g.link)) {
        var a = el('a', 'gift-link', 'Посмотреть');
        a.href = g.link; a.target = '_blank'; a.rel = 'noopener';
        body.appendChild(a);
      }
      li.appendChild(body);

      var foot = el('div', 'gift-foot');
      var busy = busyId === g.id;

      if (mine) {
        var row = el('div', 'gift-mine-row');
        row.appendChild(el('span', 'tag', 'Твой выбор'));
        var undo = el('button', 'link-btn', busy ? 'Отменяем…' : 'Отменить');
        undo.type = 'button'; undo.disabled = busy;
        undo.addEventListener('click', function () { unclaim(g); });
        row.appendChild(undo);
        foot.appendChild(row);
      } else if (taken) {
        foot.appendChild(el('span', 'tag', 'Уже выбрали'));
      } else if (askId === g.id) {
        var form = el('form', 'gift-ask');
        var input = el('input');
        input.type = 'text'; input.maxLength = 60; input.placeholder = 'Твоё имя';
        input.setAttribute('aria-label', 'Твоё имя');
        input.value = askDraft;
        input.addEventListener('input', function () { askDraft = input.value; });
        var btns = el('div', 'gift-ask-row');
        var ok = el('button', 'btn btn-solid btn-small', busy ? 'Сохраняем…' : 'Подтвердить');
        ok.type = 'submit'; ok.disabled = busy;
        var cancel = el('button', 'btn btn-ghost btn-small', 'Отмена');
        cancel.type = 'button'; cancel.disabled = busy;
        cancel.addEventListener('click', function () { askId = null; renderGifts(); });
        btns.appendChild(ok); btns.appendChild(cancel);
        form.appendChild(input); form.appendChild(btns);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var name = input.value.trim();
          if (!name) { input.focus(); return; }
          claim(g, name);
        });
        foot.appendChild(form);
        if (!busy) setTimeout(function () { input.focus(); }, 0);
      } else {
        var pick = el('button', 'btn btn-ghost btn-small', 'Выберу этот подарок');
        pick.type = 'button';
        pick.addEventListener('click', function () {
          askId = g.id;
          askDraft = store.get('inv_name') || $('rsvpName').value.trim() || '';
          giftStatus.textContent = '';
          renderGifts();
        });
        foot.appendChild(pick);
      }

      li.appendChild(foot);
      giftsEl.appendChild(li);
    });
    firstRender = false;
  }

  function claim(g, name) {
    busyId = g.id; giftStatus.textContent = ''; renderGifts();
    store.set('inv_name', name);
    api.send({ action: 'claim', giftId: g.id, giftTitle: g.title, name: name }).then(function (res) {
      busyId = null; askId = null;
      applyState(res);
      if (res.ok) { renderGifts(g.id); }
      else {
        renderGifts();
        giftStatus.textContent = res.error === 'taken'
          ? '«' + g.title + '» только что выбрал кто-то другой. Посмотри остальные идеи.'
          : 'Не получилось сохранить выбор. Попробуй ещё раз.';
      }
    }).catch(function () {
      busyId = null; renderGifts();
      giftStatus.textContent = 'Нет связи. Проверь интернет и попробуй ещё раз.';
    });
  }

  function unclaim(g) {
    busyId = g.id; giftStatus.textContent = ''; renderGifts();
    api.send({ action: 'unclaim', giftId: g.id }).then(function (res) {
      busyId = null; applyState(res); renderGifts();
    }).catch(function () {
      busyId = null; renderGifts();
      giftStatus.textContent = 'Нет связи. Проверь интернет и попробуй ещё раз.';
    });
  }

  function refresh() {
    if (busyId || document.hidden) return;
    api.state().then(function (res) {
      if (busyId) return;
      if (applyState(res)) renderGifts();
    }).catch(function () {});
  }

  renderGifts();
  refresh();
  // подтягиваем чужие выборы, пока страница открыта
  setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', refresh);

  // ── Ответ на приглашение ─────────────────────────────────────
  var form = $('rsvpForm');
  var nameInput = $('rsvpName');
  var msgInput = $('rsvpMessage');
  var submitBtn = $('rsvpSubmit');
  var rsvpStatus = $('rsvpStatus');
  var thanks = $('thanks');

  function showThanks(r) {
    $('thanksTitle').textContent = r.attending === 'yes'
      ? 'Ура, ' + r.name + '! Жду тебя'
      : 'Спасибо, ' + r.name;
    $('thanksText').textContent = r.attending === 'yes'
      ? 'Ответ сохранён. До встречи ' + day + ' ' + MONTHS[month - 1] + '.'
      : 'Жаль, что не получится. Ответ сохранён, обязательно увидимся в другой раз.';
    form.hidden = true;
    thanks.hidden = false;
  }

  var saved = store.get('inv_rsvp');
  if (saved && saved.name) {
    nameInput.value = saved.name;
    msgInput.value = saved.message || '';
    $(saved.attending === 'yes' ? 'attYes' : 'attNo').checked = true;
    showThanks(saved);
  } else if (store.get('inv_name')) {
    nameInput.value = store.get('inv_name');
  }

  $('editRsvp').addEventListener('click', function () {
    thanks.hidden = true;
    form.hidden = false;
    form.classList.add('in');
    nameInput.focus();
  });

  form.addEventListener('input', function () {
    nameInput.closest('.field').classList.remove('invalid');
    form.querySelector('.choice').classList.remove('invalid');
    rsvpStatus.textContent = '';
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameInput.value.trim();
    var att = form.querySelector('input[name="attending"]:checked');

    if (!name) {
      nameInput.closest('.field').classList.add('invalid');
      rsvpStatus.textContent = 'Напиши, пожалуйста, своё имя.';
      nameInput.focus();
      return;
    }
    if (!att) {
      form.querySelector('.choice').classList.add('invalid');
      rsvpStatus.textContent = 'Выбери, придёшь или нет.';
      return;
    }

    var data = { name: name, attending: att.value, message: msgInput.value.trim() };
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';

    api.send({ action: 'rsvp', name: data.name, attending: data.attending, message: data.message })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'error');
        store.set('inv_rsvp', data);
        store.set('inv_name', data.name);
        showThanks(data);
        thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () {
        rsvpStatus.textContent = 'Не получилось отправить. Проверь интернет и попробуй ещё раз.';
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить ответ';
      });
  });
})();
