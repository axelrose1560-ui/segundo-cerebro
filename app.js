/* ============================================
   SEGUNDO CEREBRO - App Principal
   ============================================ */

// ---- STORAGE ----
const Storage = {
    KEY: 'segundo_cerebro_entries',
    API_KEY: 'segundo_cerebro_apikey',

    getEntries() {
        try { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
        catch { return []; }
    },
    saveEntries(entries) { localStorage.setItem(this.KEY, JSON.stringify(entries)); },

    addEntry(entry) {
        const entries = this.getEntries();
        entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        entry.createdAt = new Date().toISOString();
        entries.unshift(entry);
        this.saveEntries(entries);
        return entry;
    },
    getEntry(id) { return this.getEntries().find(e => e.id === id); },
    getByArea(area) { return this.getEntries().filter(e => e.area === area && e.processed); },

    getAllFlashcards() {
        const fc = [];
        this.getEntries().forEach(entry => {
            if (entry.flashcards) {
                entry.flashcards.forEach(card => {
                    fc.push({ ...card, entryTitle: entry.title, date: entry.date, area: entry.area });
                });
            }
        });
        return fc;
    },

    getApiKey() { return localStorage.getItem(this.API_KEY) || ''; },
    setApiKey(key) { localStorage.setItem(this.API_KEY, key); },
    getModel() { return localStorage.getItem('segundo_cerebro_model') || 'gemini-2.0-flash'; },
    setModel(m) { localStorage.setItem('segundo_cerebro_model', m); },
    getProvider() { return localStorage.getItem('segundo_cerebro_provider') || 'groq'; },
    setProvider(p) { localStorage.setItem('segundo_cerebro_provider', p); },
    getGroqKey() { return localStorage.getItem('segundo_cerebro_groq_key') || ''; },
    setGroqKey(k) { localStorage.setItem('segundo_cerebro_groq_key', k); }
};

// ---- AI PROVIDER ----
const CORNELL_PROMPT = `Eres un asistente de diario personal. Analiza este texto usando el Método Cornell.
Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "title": "Título corto (máx 8 palabras)",
  "area": "UNA de: Dinero, Aprendizaje, Relaciones, Viajes, Historia, Random",
  "keyIdeas": ["idea 1", "idea 2", "idea 3"],
  "summary": "Resumen de 2-3 oraciones",
  "flashcards": [
    {"question": "Pregunta 1", "answer": "Respuesta 1"},
    {"question": "Pregunta 2", "answer": "Respuesta 2"}
  ]
}
Reglas:
- 3 a 5 ideas clave como frases cortas
- El área debe ser la más relevante al contenido
- Las flashcards deben ayudar a memorizar lo escrito
- NO incluyas markdown ni texto extra, solo JSON puro`;

const AIProvider = {
    async process(text) {
        const provider = Storage.getProvider();
        if (provider === 'groq') return this.callGroq(text);
        return this.callGemini(text);
    },

    async callGroq(text) {
        const apiKey = Storage.getGroqKey();
        if (!apiKey) throw new Error('NO_API_KEY');

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: CORNELL_PROMPT },
                    { role: 'user', content: text }
                ],
                temperature: 0.7,
                response_format: { type: 'json_object' }
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}`);
        }

        const data = await res.json();
        let txt = data.choices?.[0]?.message?.content || '';
        return this.parseResult(txt);
    },

    async callGemini(text) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) throw new Error('NO_API_KEY');

        const prompt = CORNELL_PROMPT + `\n\nTexto:\n"""\n${text}\n"""`;
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${Storage.getModel()}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                })
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}`);
        }

        const data = await res.json();
        let txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return this.parseResult(txt);
    },

    parseResult(txt) {
        txt = txt.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
        const result = JSON.parse(txt);
        const validAreas = ['Dinero', 'Aprendizaje', 'Relaciones', 'Viajes', 'Historia', 'Random'];
        if (!validAreas.includes(result.area)) result.area = 'Random';
        if (!Array.isArray(result.keyIdeas)) result.keyIdeas = [];
        if (!Array.isArray(result.flashcards)) result.flashcards = [];
        return result;
    }
};

// ---- ROUTER ----
const Router = {
    init() {
        window.addEventListener('hashchange', () => this.navigate());
        this.navigate();
    },
    navigate() {
        const hash = location.hash.slice(1) || 'diario';
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        const view = document.getElementById(`view-${hash}`);
        const tab = document.querySelector(`[data-view="${hash}"]`);
        if (view) view.classList.add('active');
        if (tab) tab.classList.add('active');
        if (hash === 'mapa') MapView.render();
        if (hash === 'flashcards') FlashcardsView.render();
    }
};

// ---- DIARY VIEW ----
const DiaryView = {
    currentEntryId: null,

    init() {
        const now = new Date();
        const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('currentDate').textContent = now.toLocaleDateString('es-ES', opts);
        this.loadSelector();
        document.getElementById('entrySelector').addEventListener('change', e => {
            e.target.value === 'new' ? this.newEntry() : this.loadEntry(e.target.value);
        });
    },

    loadSelector() {
        const sel = document.getElementById('entrySelector');
        sel.innerHTML = '<option value="new">+ Nueva entrada</option>';
        Storage.getEntries().forEach(entry => {
            const o = document.createElement('option');
            o.value = entry.id;
            const d = new Date(entry.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            o.textContent = entry.processed ? `${d} — ${entry.title}` : `${d} — (sin procesar)`;
            sel.appendChild(o);
        });
    },

    loadEntry(id) {
        const entry = Storage.getEntry(id);
        if (!entry) return;
        this.currentEntryId = id;
        document.getElementById('diaryText').value = entry.rawText;
        document.getElementById('keyIdeasText').value = entry.keyIdeasText || (entry.keyIdeas || []).join('\n');
        document.getElementById('daySummary').value = entry.summary || '';
        if (entry.processed) {
            this.renderCornell(entry);
            document.getElementById('diaryText').readOnly = true;
            document.getElementById('keyIdeasText').readOnly = true;
            document.getElementById('daySummary').readOnly = true;
            document.getElementById('processBtn').style.display = 'none';
            document.getElementById('newEntryBtn').style.display = 'flex';
        } else {
            this.clearCornell();
            document.getElementById('processBtn').style.display = 'flex';
            document.getElementById('newEntryBtn').style.display = 'none';
        }
    },

    newEntry() {
        this.currentEntryId = null;
        document.getElementById('diaryText').value = '';
        document.getElementById('diaryText').readOnly = false;
        document.getElementById('keyIdeasText').value = '';
        document.getElementById('keyIdeasText').readOnly = false;
        document.getElementById('daySummary').value = '';
        document.getElementById('daySummary').readOnly = false;
        document.getElementById('entrySelector').value = 'new';
        document.getElementById('processBtn').style.display = 'flex';
        document.getElementById('newEntryBtn').style.display = 'none';
        this.clearCornell();
        document.getElementById('diaryText').focus();
    },

    clearCornell() {
        document.getElementById('entryTitle').textContent = 'Nueva Entrada';
        const badge = document.getElementById('entryArea');
        badge.textContent = 'Sin área';
        badge.className = 'area-badge area-badge-empty';
    },

    renderCornell(data) {
        document.getElementById('entryTitle').textContent = data.title;
        const badge = document.getElementById('entryArea');
        badge.textContent = data.area;
        badge.className = 'area-badge area-' + data.area.toLowerCase();
        document.getElementById('keyIdeasText').value = (data.keyIdeas || []).join('\n');
        document.getElementById('daySummary').value = data.summary || '';
    },

    async process() {
        const text = document.getElementById('diaryText').value.trim();
        if (!text) { App.toast('Escribe algo en tu diario primero ✏️'); return; }
        const provider = Storage.getProvider();
        const hasKey = provider === 'groq' ? Storage.getGroqKey() : Storage.getApiKey();
        if (!hasKey) { Settings.open(); App.toast('Configura tu API key primero'); return; }

        document.getElementById('loadingOverlay').style.display = 'flex';
        document.getElementById('processBtn').disabled = true;

        try {
            const result = await AIProvider.process(text);
            const entry = Storage.addEntry({
                date: new Date().toISOString().split('T')[0],
                rawText: text,
                title: result.title,
                area: result.area,
                keyIdeas: result.keyIdeas,
                keyIdeasText: result.keyIdeas.join('\n'),
                summary: result.summary,
                flashcards: result.flashcards,
                processed: true
            });
            this.currentEntryId = entry.id;
            this.renderCornell(result);
            document.getElementById('diaryText').readOnly = true;
            document.getElementById('keyIdeasText').readOnly = true;
            document.getElementById('daySummary').readOnly = true;
            document.getElementById('processBtn').style.display = 'none';
            document.getElementById('newEntryBtn').style.display = 'flex';
            this.loadSelector();
            document.getElementById('entrySelector').value = entry.id;
            App.toast('✅ ¡Entrada procesada!');
        } catch (err) {
            console.error(err);
            if (err.message === 'NO_API_KEY') {
                Settings.open();
            } else {
                App.toast('❌ Error: ' + err.message);
            }
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
            document.getElementById('processBtn').disabled = false;
        }
    }
};

// ---- MAP VIEW ----
const MapView = {
    areas: [
        { key: 'Dinero', icon: '💰', css: 'area-dinero' },
        { key: 'Aprendizaje', icon: '📚', css: 'area-aprendizaje' },
        { key: 'Relaciones', icon: '❤️', css: 'area-relaciones' },
        { key: 'Viajes', icon: '✈️', css: 'area-viajes' },
        { key: 'Historia', icon: '📖', css: 'area-historia' },
        { key: 'Random', icon: '🎲', css: 'area-random' }
    ],

    render() {
        this.renderCards();
        this.renderTimeline();
    },

    renderCards() {
        const grid = document.getElementById('areasGrid');
        grid.innerHTML = '';
        this.areas.forEach(area => {
            const entries = Storage.getByArea(area.key);
            const ideas = entries.flatMap(e => e.keyIdeas || []);
            const card = document.createElement('div');
            card.className = `area-card ${area.css}`;
            card.innerHTML = `
                <span class="area-card-icon">${area.icon}</span>
                <div class="area-card-name">${area.key}</div>
                <div class="area-card-count">${ideas.length} ideas</div>
                <ul class="area-card-ideas">
                    ${ideas.length ? ideas.map(i => `<li>${i}</li>`).join('') : '<li>Sin ideas aún</li>'}
                </ul>`;
            card.addEventListener('click', () => card.classList.toggle('expanded'));
            grid.appendChild(card);
        });
    },

    renderTimeline() {
        const tl = document.getElementById('timeline');
        const entries = Storage.getEntries().filter(e => e.processed);
        if (!entries.length) {
            tl.innerHTML = '<p class="placeholder">Escribe entradas en tu diario para ver la línea de tiempo</p>';
            return;
        }
        const areaColors = {
            Dinero: '#27AE60', Aprendizaje: '#2E86AB', Relaciones: '#E74C3C',
            Viajes: '#F39C12', Historia: '#8E44AD', Random: '#7F8C8D'
        };
        tl.innerHTML = entries.map(e => {
            const d = new Date(e.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
            const color = areaColors[e.area] || '#7F8C8D';
            return `<div class="timeline-item" style="--dot-color:${color}" onclick="location.hash='diario';setTimeout(()=>{document.getElementById('entrySelector').value='${e.id}';DiaryView.loadEntry('${e.id}')},100)">
                <div class="timeline-date">${d}</div>
                <div class="timeline-entry-title">${e.title}</div>
            </div>`;
        }).join('');
        // Apply dot colors
        tl.querySelectorAll('.timeline-item').forEach(item => {
            item.style.setProperty('--dot-bg', item.style.getPropertyValue('--dot-color'));
        });
    }
};

// ---- FLASHCARDS VIEW ----
const FlashcardsView = {
    cards: [],
    index: 0,

    render() {
        this.cards = Storage.getAllFlashcards();
        const empty = document.getElementById('flashcardEmpty');
        const player = document.getElementById('flashcardPlayer');
        if (!this.cards.length) {
            empty.style.display = 'block';
            player.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        player.style.display = 'block';
        this.index = 0;
        this.showCard();
        this.renderDots();
    },

    showCard() {
        const card = this.cards[this.index];
        if (!card) return;
        document.getElementById('fcQuestion').textContent = card.question;
        document.getElementById('fcAnswer').textContent = card.answer;
        document.getElementById('fcCurrent').textContent = this.index + 1;
        document.getElementById('fcTotal').textContent = this.cards.length;
        document.getElementById('flashcard').classList.remove('flipped');
        this.updateDots();
    },

    renderDots() {
        const dots = document.getElementById('fcDots');
        const maxDots = Math.min(this.cards.length, 10);
        dots.innerHTML = '';
        for (let i = 0; i < maxDots; i++) {
            const dot = document.createElement('span');
            dot.className = 'fc-dot' + (i === 0 ? ' active' : '');
            dots.appendChild(dot);
        }
    },

    updateDots() {
        const dots = document.querySelectorAll('.fc-dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === this.index % dots.length));
    },

    flip() { document.getElementById('flashcard').classList.toggle('flipped'); },

    next() {
        if (this.index < this.cards.length - 1) { this.index++; this.showCard(); }
    },

    prev() {
        if (this.index > 0) { this.index--; this.showCard(); }
    }
};

// ---- SETTINGS ----
const Settings = {
    open() {
        document.getElementById('providerSelect').value = Storage.getProvider();
        document.getElementById('groqKeyInput').value = Storage.getGroqKey();
        document.getElementById('apiKeyInput').value = Storage.getApiKey();
        document.getElementById('modelSelect').value = Storage.getModel();
        this.toggleProvider();
        document.getElementById('settingsModal').style.display = 'flex';
    },
    close(e) {
        if (e && e.target !== document.getElementById('settingsModal')) return;
        document.getElementById('settingsModal').style.display = 'none';
    },
    toggleProvider() {
        const provider = document.getElementById('providerSelect').value;
        document.getElementById('groqSettings').style.display = provider === 'groq' ? 'block' : 'none';
        document.getElementById('geminiSettings').style.display = provider === 'gemini' ? 'block' : 'none';
    },
    save() {
        const provider = document.getElementById('providerSelect').value;
        Storage.setProvider(provider);
        Storage.setGroqKey(document.getElementById('groqKeyInput').value.trim());
        Storage.setApiKey(document.getElementById('apiKeyInput').value.trim());
        Storage.setModel(document.getElementById('modelSelect').value);
        document.getElementById('settingsModal').style.display = 'none';
        const name = provider === 'groq' ? '🚀 Groq' : '🔮 Gemini';
        App.toast(`✅ Guardado (${name})`);
    }
};

// ---- APP ----
const App = {
    init() {
        Router.init();
        DiaryView.init();
        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => { });
        }
        // Show settings if no API key for current provider
        const provider = Storage.getProvider();
        const hasKey = provider === 'groq' ? Storage.getGroqKey() : Storage.getApiKey();
        if (!hasKey) {
            setTimeout(() => Settings.open(), 500);
        }
    },
    toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }
};

// Add timeline dot color via CSS
const style = document.createElement('style');
style.textContent = `.timeline-item::before { background: var(--dot-color, #7F8C8D); }`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => App.init());
