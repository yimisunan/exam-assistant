// === 考试助手 V0.3.0 核心逻辑库 ===

// 基础工具函数
function getHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        let chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash.toString(36);
}
function getFingerprint(str) { return str.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ''); }
function cleanQuestionForStorage(q) { let copy = JSON.parse(JSON.stringify(q)); delete copy.optMap; return copy; }

// --- 路由与视图控制 ---
const Router = {
    navigate: function(pageId) {
        ['page-home', 'page-quiz', 'page-result', 'page-tutor'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === pageId) el.classList.remove('hidden');
                else el.classList.add('hidden');
            }
        });
        window.scrollTo(0, 0);
    },
    openTutorPage: function() {
        closeDrawer();
        this.navigate('page-tutor');
    },
    closeTutorPage: function() {
        this.navigate('page-home');
        renderBankList();
        updateDashboard();
    }
};

window.Router = Router;

window.openDrawer = function() {
    document.getElementById('side-drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
    document.body.style.overflow = 'hidden'; 
};
window.closeDrawer = function() {
    document.getElementById('side-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
    document.body.style.overflow = '';
};

// --- 全局数据初始化 ---
(function migrateOldData() {
    ['banks', 'global_stats', 'test_mode', 'need_sync', 'fold_state', 'settings_open', 'github_token'].forEach(k => {
        let oldKey = 'szys_' + k; let newKey = 'exam_' + k;
        if(localStorage.getItem(oldKey) && !localStorage.getItem(newKey)) {
            localStorage.setItem(newKey, localStorage.getItem(oldKey));
        }
    });
})();

let banks = JSON.parse(localStorage.getItem('exam_banks') || '{}');
if (!banks['sys_wrong']) banks['sys_wrong'] = { name: "💔 我的错题本", data: [], isSystem: true, sysType: 'wrong' };
if (!banks['sys_star']) banks['sys_star'] = { name: "⭐ 专属收藏夹", data: [], isSystem: true, sysType: 'star' };

let globalStats = JSON.parse(localStorage.getItem('exam_global_stats') || '{"totalAnswered": 0, "totalCorrect": 0, "challenge": {}, "mastered": [], "attempted": []}');
if(globalStats.totalCorrect === undefined) globalStats.totalCorrect = 0;
if(globalStats.totalAnswered === undefined) globalStats.totalAnswered = 0;
if(!globalStats.challenge) globalStats.challenge = { easy:0, normal:0, hard:0, extreme:0 };
if(!globalStats.mastered) globalStats.mastered = [];
if(!globalStats.attempted) globalStats.attempted = [];

let isTestMode = localStorage.getItem('exam_test_mode') === 'true';
let needSync = localStorage.getItem('exam_need_sync') === 'true';
let foldState = JSON.parse(localStorage.getItem('exam_fold_state') || '{"fold-tools":false, "fold-sys":false, "fold-arena":false, "fold-dev":false}');
let isSettingsOpen = localStorage.getItem('exam_settings_open') === 'true';

const UNLOCK_REQS_Q = { 'easy': 70, 'normal': 210, 'hard': 420, 'extreme': 630 };
const UNLOCK_REQS_C = { 'easy': 30, 'normal': 90, 'hard': 180, 'extreme': 300 };
const UNLOCK_PRE = { 'easy': null, 'normal': 'easy', 'hard': 'normal', 'extreme': 'hard' };
const PRE_NAMES = { 'easy': '简单', 'normal': '普通', 'hard': '困难', 'extreme': '极限' };

const App = { bankId: null, data: [], current: 0, score: 0, mode: 'instant', wrongList: [], stars: new Set(), selected: [], isAnswered: false, timerMode: false, timeRemaining: 0, isChallenge: false, challengeDiff: null, optShuffle: false, isCompletedBank: false, isSystemBank: false };
let timerInterval = null;

// --- 系统模态框控制器 ---
const SysModal = {
    timer: null,
    show: function(title, desc, isDanger, onConfirm) {
        document.getElementById('sys-modal').classList.remove('hidden');
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-desc').innerHTML = desc;
        
        let btnC = document.getElementById('modal-btn-confirm');
        let btnCancel = document.getElementById('modal-btn-cancel');
        
        btnCancel.style.display = 'inline-block';
        btnC.className = isDanger ? "btn btn-danger" : "btn btn-primary";
        btnC.disabled = true;
        btnCancel.onclick = () => { this.hide(); };
        
        let cd = 3; btnC.innerText = `强制等待 (${cd}s)`;
        if(this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            cd--;
            if(cd <= 0) {
                clearInterval(this.timer); btnC.disabled = false;
                btnC.innerText = isDanger ? "我已知晓，确认执行" : "确认执行";
                btnC.onclick = () => { this.hide(); onConfirm(); };
            } else { btnC.innerText = `强制等待 (${cd}s)`; }
        }, 1000);
    },
    alert: function(title, desc) {
        document.getElementById('sys-modal').classList.remove('hidden');
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-desc').innerHTML = desc;
        
        let btnC = document.getElementById('modal-btn-confirm');
        let btnCancel = document.getElementById('modal-btn-cancel');
        
        btnCancel.style.display = 'none'; 
        btnC.className = "btn btn-primary";
        btnC.disabled = false;
        btnC.innerText = "我知道了";
        if(this.timer) clearInterval(this.timer);
        btnC.onclick = () => { this.hide(); };
    },
    hide: function() { 
        document.getElementById('sys-modal').classList.add('hidden'); 
        if(this.timer) clearInterval(this.timer); 
        document.getElementById('modal-btn-cancel').style.display = 'inline-block';
    }
};

window.alert = function(msg) {
    SysModal.alert("系统提示", String(msg).replace(/\n/g, '<br>'));
};

window.onload = function() { 
    renderBankList(); updateDashboard(); initUIState(); applyFoldState(); applyQuizSettingsState(); setNeedSync(needSync); 
    let savedToken = localStorage.getItem('exam_github_token'); 
    if(savedToken) document.getElementById('github-token-input').value = savedToken; 
    
    if(isTestMode) {
        document.getElementById('test-console').classList.remove('hidden');
        let tBtn = document.getElementById('test-mode-toggle-btn');
        tBtn.innerText = "关闭测试模式 (将核爆清空所有假数据)"; tBtn.className = "btn btn-danger";
        document.getElementById('btn-cloud-backup').disabled = true; document.getElementById('btn-cloud-restore').disabled = true;
    }

    if(localStorage.getItem('exam_last_report')) {
        document.getElementById('recovery-banner').classList.remove('hidden');
    }
};

function saveBanks() { localStorage.setItem('exam_banks', JSON.stringify(banks)); updateDashboard(); setNeedSync(true); }
function saveGlobalStats() { localStorage.setItem('exam_global_stats', JSON.stringify(globalStats)); updateDashboard(); setNeedSync(true); }

function setNeedSync(state) {
    if(isTestMode && state) return; 
    needSync = state; localStorage.setItem('exam_need_sync', state);
    if(state) {
        document.getElementById('sync-dot-header').classList.remove('hidden'); 
        document.getElementById('sync-dot-btn').classList.remove('hidden');
        document.getElementById('sync-dot-global').classList.remove('hidden');
    } else {
        document.getElementById('sync-dot-header').classList.add('hidden'); 
        document.getElementById('sync-dot-btn').classList.add('hidden');
        document.getElementById('sync-dot-global').classList.add('hidden');
    }
}

window.toggleFold = function(id) { 
    let el = document.getElementById(id); el.classList.toggle('open'); 
    foldState[id] = el.classList.contains('open'); localStorage.setItem('exam_fold_state', JSON.stringify(foldState));
};

function applyFoldState() { for(let id in foldState) { if(foldState[id] && document.getElementById(id)) { document.getElementById(id).classList.add('open'); } } }

window.toggleQuizSettings = function() {
    isSettingsOpen = !isSettingsOpen; localStorage.setItem('exam_settings_open', isSettingsOpen); applyQuizSettingsState();
};

function applyQuizSettingsState() {
    const panel = document.getElementById('quiz-settings-panel'); const btn = document.getElementById('quiz-settings-btn');
    if (isSettingsOpen) {
        panel.classList.remove('hidden'); btn.innerText = '收起设置 ▲'; btn.style.color = '#64748b'; btn.style.background = '#f1f5f9'; btn.style.borderColor = '#cbd5e1';
    } else {
        panel.classList.add('hidden'); btn.innerText = '⚙️ 展开偏好设置'; btn.style.color = '#3b82f6'; btn.style.background = '#eff6ff'; btn.style.borderColor = '#bfdbfe';
    }
}

function initUIState() {
    let customCount = 0; for (let id in banks) { if(!banks[id].isSystem) customCount++; }
    if (customCount > 0) { hideImportSection(); } else { showImportSection(); }
}
window.showImportSection = function() { document.getElementById('import-section-collapsed').classList.add('hidden'); document.getElementById('import-section-expanded').classList.remove('hidden'); }
window.hideImportSection = function() { document.getElementById('import-section-collapsed').classList.remove('hidden'); document.getElementById('import-section-expanded').classList.add('hidden'); }

function updateDashboard() {
    let totalQ = 0; 
    for (let id in banks) { 
        if(!banks[id] || typeof banks[id] !== 'object' || !banks[id].data) continue;
        if(!banks[id].isSystem) totalQ += banks[id].data.length; 
    }
    document.getElementById('mini-stats-1').innerText = `| 库容 ${totalQ} 题 · 答对 ${globalStats.totalCorrect}`;
    let wrongCount = banks['sys_wrong'] && banks['sys_wrong'].data ? banks['sys_wrong'].data.length : 0;
    let starCount = banks['sys_star'] && banks['sys_star'].data ? banks['sys_star'].data.length : 0;
    document.getElementById('mini-stats-sys').innerText = `| 错题 ${wrongCount} · 收藏 ${starCount}`;
    let totalClear = (globalStats.challenge.easy||0) + (globalStats.challenge.normal||0) + (globalStats.challenge.hard||0) + (globalStats.challenge.extreme||0);
    document.getElementById('mini-stats-2').innerText = `| 累计过关 ${totalClear} 次`;
    document.getElementById('global-total-q').innerText = totalQ;
    document.getElementById('global-total-ans').innerText = globalStats.totalAnswered; document.getElementById('global-total-cor').innerText = globalStats.totalCorrect;
    document.getElementById('honor-easy').innerText = globalStats.challenge.easy || 0; document.getElementById('honor-normal').innerText = globalStats.challenge.normal || 0;
    document.getElementById('honor-hard').innerText = globalStats.challenge.hard || 0; document.getElementById('honor-extreme').innerText = globalStats.challenge.extreme || 0;

    let modes = ['easy', 'normal', 'hard', 'extreme'];
    modes.forEach(mode => {
        let el = document.getElementById('arena-' + mode); let msgEl = document.getElementById('lock-msg-' + mode);
        let reqQ = UNLOCK_REQS_Q[mode]; let reqC = UNLOCK_REQS_C[mode]; let preReqMode = UNLOCK_PRE[mode];
        let isQLocked = totalQ < reqQ; let isCLocked = globalStats.totalCorrect < reqC; let isPreLocked = preReqMode ? (globalStats.challenge[preReqMode] || 0) < 1 : false;

        if(isQLocked || isCLocked || isPreLocked) {
            el.classList.add('locked-mode'); let lockReasons = [];
            if(isPreLocked) lockReasons.push(`需先通关[${PRE_NAMES[preReqMode]}]`);
            if(isQLocked) lockReasons.push(`库容>${reqQ}`);
            if(isCLocked) lockReasons.push(`答对>${reqC}`);
            msgEl.innerHTML = '🔒 锁定: ' + lockReasons.join(' <br> ');
        } else { el.classList.remove('locked-mode'); msgEl.innerText = ''; }
    });
}

// --- 沙盒隔离引擎 ---
const SandboxEngine = {
    toggleTestMode: function() {
        if (!isTestMode) {
            let totalQ = 0; for (let id in banks) { if(!banks[id] || !banks[id].data) continue; if(!banks[id].isSystem) totalQ += banks[id].data.length; }
            if (totalQ > 0 || globalStats.totalAnswered > 0 || globalStats.totalCorrect > 0) return alert("⚠️ 无法开启测试模式！\n\n为了防止假数据污染您的心血存档，测试模式仅能在【0题库、0进度】的纯净状态下开启。\n请先使用下方红色的“一键重置”并在上方删除所有题库。");
            localStorage.setItem('exam_test_mode', 'true'); alert("🔧 开发者沙盒已激活！"); location.reload();
        } else {
            banks = { 'sys_wrong': { name: "💔 我的错题本", data: [], isSystem: true, sysType: 'wrong' }, 'sys_star': { name: "⭐ 专属收藏夹", data: [], isSystem: true, sysType: 'star' } }; 
            globalStats = { totalAnswered: 0, totalCorrect: 0, challenge: { easy:0, normal:0, hard:0, extreme:0 }, mastered: [], attempted: [] };
            saveBanks(); saveGlobalStats(); localStorage.removeItem('exam_state'); localStorage.removeItem('exam_last_report'); setNeedSync(false);
            localStorage.setItem('exam_test_mode', 'false'); alert("✅ 已退出测试模式，所有测试假数据已核爆销毁，系统恢复纯净！"); location.reload();
        }
    },
    injectProfessorTutorData: function() {
        let mockQ1 = {
            id: "test_q1_" + Date.now(),
            question: "[材料原文：这是沙盒测试环境自动注入的一段极简测试材料，用于验证材料折叠逻辑与导师卡片渲染是否正常工作。]\n针对该材料，以下说法正确的是？",
            options: {A:"说法甲", B:"说法乙", C:"说法丙", D:"说法丁"}, answer: "B", type: "single", source: "沙盒测试引擎"
        };
        let mockQ2 = {
            id: "test_q2_" + Date.now(),
            question: "这是一道独立的单选题，没有材料，用于测试独立题的导师卡片渲染与核销闭环。",
            options: {A:"选项甲", B:"选项乙", C:"选项丙", D:"选项丁"}, answer: "A", type: "single", source: "沙盒测试引擎"
        };

        banks['sys_wrong'].data.push(mockQ1); banks['sys_wrong'].data.push(mockQ2);
        saveBanks(); renderBankList(); 

        let mockJSON = [
            {
                "original_question": mockQ1.question, "my_answer": "A", "correct_answer": "B",
                "explanation": "🔍 **陷阱剖析**：\n你选择了 A，说明你把“说法甲”和“说法乙”发生的先后顺序与因果关系混淆了。\n\n🧠 **核心原理解析**：\n这道题考察的核心是基础概念的辨析。就像英国之所以能率先爆发工业革命，根本前提是它最早确立了资本主义制度一样。\n\n💡 **举一反三**：\n记住这个推导链条：制度先发 -> 产权保护 -> 结果产生。以后遇到此类起源题，先找“前提优势”。",
                "rationale": "沙盒测试依据原文：这是从云盘中提取的虚拟原文。"
            },
            {
                "original_question": mockQ2.question, "my_answer": "C", "correct_answer": "A",
                "explanation": "🔍 **陷阱剖析**：\n选择了 C，说明你没有理解题目中的绝对否定词。\n\n🧠 **核心原理解析**：\n这是一段独立的沙盒测试解析，没有材料折叠框。考察的重点在于对概念的精确记忆。\n\n💡 **举一反三**：\n注意题干中的“没有”二字。点击顿悟后，此题将从错题本中物理删除。",
                "rationale": "未在云盘检索到原文。"
            }
        ];

        document.getElementById('tutor-input').value = JSON.stringify(mockJSON, null, 2);
        Router.openTutorPage(); generateTutorCards();
    },
    unlockAllArenas: function() {
        let dummyData = [];
        for(let i=0; i<700; i++) { 
            let qText = `[沙盒] 这是用于撑大题库容量的假题 ${i}_${Date.now()}`;
            dummyData.push({question: qText, options: {A:"选项甲", B:"选项乙", C:"选项丙", D:"选项丁"}, answer: "A", type: "single", source: "沙盒引擎"}); 
            let fpHash = getHash(getFingerprint(qText));
            if(i < 500) { globalStats.mastered.push(fpHash); }
            if(i < 600) { globalStats.attempted.push(fpHash); }
        }
        banks['test_arena_' + Date.now()] = { name: "🧪 竞技场解锁专用库(700题)", data: dummyData, completed: false, maxRate: 0 };
        
        globalStats.totalCorrect += 500; globalStats.totalAnswered += 600;
        globalStats.challenge.easy = (globalStats.challenge.easy || 0) + 1;
        globalStats.challenge.normal = (globalStats.challenge.normal || 0) + 1;
        globalStats.challenge.hard = (globalStats.challenge.hard || 0) + 1;
        
        saveBanks(); saveGlobalStats(); renderBankList(); updateDashboard();
        alert("✅ 已注入 700 道题目并修改大盘数据，竞技场全难度模式现已解锁！");
    },
    injectWrongAndStar: function() {
        for(let i=1; i<=15; i++) {
            banks['sys_wrong'].data.push({question: `[模拟测试题 ${Date.now()}] 这是沙盒自动生成的错题记录 ${i}`, options: {A:"甲",B:"乙",C:"丙",D:"丁"}, answer: "A", type: "single", source: "沙盒"});
            if(i<=5) { banks['sys_star'].data.push({question: `[模拟收藏题 ${Date.now()}] 这是沙盒自动生成的星标题 ${i}`, options: {A:"A",B:"B",C:"C",D:"D"}, answer: "B", type: "single", source: "沙盒"}); }
        }
        saveBanks(); renderBankList(); updateDashboard();
        alert("✅ 成功瞬间注入 15 道错题与 5 道收藏题！请前往左侧抽屉面板查看【专项特训】。");
    },
    mockInterruptState: function() {
        let bId = Object.keys(banks).find(k => !banks[k].isSystem);
        if (!bId) { this.injectBanks(); bId = Object.keys(banks).find(k => !banks[k].isSystem); }
        
        let state = { 
            bankId: bId, current: 5, score: 3, mode: 'instant', wrongList: [], stars: [], 
            isAnswered: false, selected: [], activeData: banks[bId].data, timerMode: true, timeRemaining: 1500, optShuffle: false 
        };
        localStorage.setItem('exam_state', JSON.stringify(state)); renderBankList();
        alert("✅ 中断存档已伪造！请观察主页常规题库中的【继续作答】按钮，点击即可恢复到第 6 题进度。");
    },
    jumpToResult: function() {
        App.data = new Array(20).fill({}); App.score = 8; App.wrongList = [];
        for(let i=1; i<=12; i++) {
            App.wrongList.push({ id: "wq_"+i, q: `这是一道用于测试 Markdown 提取和分页逻辑的假错题 ${i}`, options: {A:"测试", B:"测试"}, source: "沙盒模拟", my: "B", right: "A", reason: "答错" });
        }
        App.isChallenge = false; App.bankId = 'test_bank'; App.isSystemBank = false;
        showResult();
    },
    injectBanks: function() {
        let dummyData = []; for(let i=0; i<100; i++) { dummyData.push({question: `[沙盒测试题目 ${i+1}] 这是一道由开发者引擎生成的虚假题目用于撑起库容。`, options: {A:"选项甲", B:"选项乙", C:"选项丙", D:"选项丁"}, answer: "A", type: "single", source: "测试引擎"}); }
        banks['test_' + Date.now()] = { name: "🧪 100题测试容量包", data: dummyData, completed: false, maxRate: 0 };
        saveBanks(); renderBankList(); initUIState(); alert("✅ 成功注入 100 道假题");
    },
    triggerRedDot: function() { setNeedSync(true); alert("🔴 警示红点已强制点亮，请查看左侧抽屉面板！"); },
    triggerEpicModal: function() { showEpicModal("史诗成就达成 (沙盒测试)", "这只是一个测试弹窗，用于验证您的史诗级荣誉是否能正常唤起云端封存。在真实环境下，达成 100% 毕业或极限通关会自动触发。"); },
    resetAllStatsFlow: function() {
        SysModal.show("🔥 最高级危险：清除个人进度", "您正在试图清空<span style='color:#ef4444;font-weight:bold;'>所有大盘数据、荣誉、100%章以及【错题/收藏】</span>（题库题目保留）。<br><br>清空后绝无找回可能，请慎重决定！", true, () => {
            globalStats = { totalAnswered: 0, totalCorrect: 0, challenge: { easy:0, normal:0, hard:0, extreme:0 }, mastered: [], attempted: [] };
            banks['sys_wrong'].data = []; banks['sys_star'].data = [];
            for(let id in banks) { if(banks[id] && banks[id].data && !banks[id].isSystem) { banks[id].completed = false; banks[id].maxRate = 0; } }
            saveBanks(); saveGlobalStats(); localStorage.removeItem('exam_state'); localStorage.removeItem('exam_last_report'); setNeedSync(false);
            alert("✅ 所有进度数据、错题本与收藏夹已彻底重置。"); location.reload();
        });
    }
};

window.SandboxEngine = SandboxEngine;

// --- 其他全局业务函数 ---
window.showEpicModal = function(title, desc) { document.getElementById('epic-modal').classList.remove('hidden'); document.getElementById('epic-title').innerText = title; document.getElementById('epic-desc').innerText = desc; };
window.epicCloudBackupFlow = function() {
    document.getElementById('epic-modal').classList.add('hidden');
    if(isTestMode) return alert("⛔ 物理熔断：沙盒测试模式下严禁上传假数据至云端！");
    let token = document.getElementById('github-token-input').value.trim(); 
    if(!token) return alert("请先在抽屉面板中填写 GitHub 密钥后再试！");
    executeCloudBackup(token);
};
window.cloudBackupFlow = function() {
    if(isTestMode) return alert("⛔ 物理熔断：沙盒测试模式下严禁上传假数据至云端！");
    let token = document.getElementById('github-token-input').value.trim(); if(!token) return alert("请先填写 GitHub 密钥！");
    
    let hasCustomBanks = false;
    for(let id in banks) { if(banks[id] && banks[id].data && !banks[id].isSystem) hasCustomBanks = true; }
    
    let wrongCount = banks['sys_wrong'] && banks['sys_wrong'].data ? banks['sys_wrong'].data.length : 0;
    let starCount = banks['sys_star'] && banks['sys_star'].data ? banks['sys_star'].data.length : 0;
    
    if (!hasCustomBanks && wrongCount === 0 && starCount === 0) return alert("本地暂无有效题库数据可备份。");
    SysModal.show("☁️ 确认备份至云端？", "此操作会将您当前的<span style='color:#3b82f6;font-weight:bold;'>题库、错题本、进度、荣誉</span>全部上传覆盖旧存档。", false, () => { executeCloudBackup(token); });
};
window.cloudRestoreFlow = function() {
    if(isTestMode) return alert("⛔ 物理熔断：沙盒测试模式下严禁从云端拉取数据！");
    let token = document.getElementById('github-token-input').value.trim(); if(!token) return alert("请先填写 GitHub 密钥！");
    SysModal.show("⚠️ 严重警告：云端强制覆盖", "系统将直接拉取云端存档，并<span style='color:#ef4444;font-weight:bold;'>完全抹除替换</span>您当前手机上的所有题库与进度！<br><br>一旦覆盖，本地丢失数据将无法找回。", true, () => { executeCloudRestore(token); });
};

async function executeCloudBackup(token) {
    localStorage.setItem('exam_github_token', token);
    let backupPayload = { version: "0.1", banks: banks, state: JSON.parse(localStorage.getItem('exam_state') || 'null'), stats: globalStats };
    let payloadStr = JSON.stringify(backupPayload);

    const btn = document.getElementById('btn-cloud-backup');
    let oriHtml = btn.innerHTML; btn.innerHTML = "⏳ 加密上传中..."; btn.disabled = true;

    try {
        let res = await fetch('https://api.github.com/gists', { headers: { 'Authorization': 'token ' + token }});
        if(!res.ok) throw new Error("密钥验证失败");
        let gists = await res.json(); let targetGist = gists.find(g => g.files['exam_backup.json'] || g.files['szys_backup.json']);
        if(targetGist) { await fetch('https://api.github.com/gists/' + targetGist.id, { method: 'PATCH', headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: { 'exam_backup.json': { content: payloadStr } } }) }); } 
        else { await fetch('https://api.github.com/gists', { method: 'POST', headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: "考试助手 V0.1 题库备份", public: false, files: { 'exam_backup.json': { content: payloadStr } } }) }); }
        
        btn.innerHTML = oriHtml; btn.disabled = false; setNeedSync(false); alert("✅ 漫游数据备份成功！");
    } catch(e) { btn.innerHTML = oriHtml; btn.disabled = false; alert("❌ 备份出错：" + e.message); } 
}

async function executeCloudRestore(token) {
    localStorage.setItem('exam_github_token', token);
    const btn = document.getElementById('btn-cloud-restore'); let oriTxt = btn.innerText; btn.innerText = "⏳ 强制穿透拉取中..."; btn.disabled = true;
    try {
        let res = await fetch('https://api.github.com/gists', { headers: { 'Authorization': 'token ' + token }});
        if(!res.ok) throw new Error("密钥验证失败");
        let gists = await res.json(); let targetGist = gists.find(g => g.files['exam_backup.json'] || g.files['szys_backup.json']);
        if(!targetGist) throw new Error("您的云端空间中未找到备份数据");
        
        let rawUrl = targetGist.files['exam_backup.json'] ? targetGist.files['exam_backup.json'].raw_url : targetGist.files['szys_backup.json'].raw_url;
        let fileRes = await fetch(rawUrl + (rawUrl.includes('?') ? '&' : '?') + 't=' + Date.now());
        let importedData = await fileRes.json();
        
        if (importedData.banks) {
            banks = importedData.banks;
            if (!banks['sys_wrong']) banks['sys_wrong'] = { name: "💔 我的错题本", data: [], isSystem: true, sysType: 'wrong' };
            if (!banks['sys_star']) banks['sys_star'] = { name: "⭐ 专属收藏夹", data: [], isSystem: true, sysType: 'star' };
            
            globalStats = importedData.stats || {totalAnswered: 0, totalCorrect: 0, challenge: {easy:0,normal:0,hard:0,extreme:0}, mastered: [], attempted: []};
            if(!globalStats.mastered) globalStats.mastered = [];
            if(!globalStats.attempted) globalStats.attempted = [];

            if (importedData.state) { localStorage.setItem('exam_state', JSON.stringify(importedData.state)); } else { localStorage.removeItem('exam_state'); }
        } else { 
            banks = importedData; 
            if (!banks['sys_wrong']) banks['sys_wrong'] = { name: "💔 我的错题本", data: [], isSystem: true, sysType: 'wrong' };
            if (!banks['sys_star']) banks['sys_star'] = { name: "⭐ 专属收藏夹", data: [], isSystem: true, sysType: 'star' };
        }
        saveBanks(); saveGlobalStats(); setNeedSync(false); alert(`✅ 云端覆盖成功！已全量恢复您的专属状态。`); location.reload();
    } catch(e) { alert("❌ 恢复出错：" + e.message); } finally { btn.innerText = oriTxt; btn.disabled = false; }
}

window.exportLocalData = function() {
    let hasCustomBanks = false;
    for(let id in banks) { if(banks[id] && banks[id].data && !banks[id].isSystem) hasCustomBanks = true; }
    let wrongCount = banks['sys_wrong'] && banks['sys_wrong'].data ? banks['sys_wrong'].data.length : 0;
    
    if (!hasCustomBanks && wrongCount === 0) return alert("暂无数据可导出");
    let backupPayload = { version: "0.1", banks: banks, state: JSON.parse(localStorage.getItem('exam_state') || 'null'), stats: globalStats };
    let blob = new Blob([JSON.stringify(backupPayload)], { type: "application/json" }); let url = URL.createObjectURL(blob); let a = document.createElement('a'); a.href = url;
    a.download = `考试助手全量备份_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
};
window.importLocalData = function(event) {
    let file = event.target.files[0]; if (!file) return; let reader = new FileReader();
    reader.onload = function(e) {
        try {
            let importedData = JSON.parse(e.target.result);
            if (importedData.banks) {
                banks = importedData.banks;
                if (!banks['sys_wrong']) banks['sys_wrong'] = { name: "💔 我的错题本", data: [], isSystem: true, sysType: 'wrong' };
                if (!banks['sys_star']) banks['sys_star'] = { name: "⭐ 专属收藏夹", data: [], isSystem: true, sysType: 'star' };
                globalStats = importedData.stats || {totalAnswered: 0, totalCorrect: 0, challenge: {easy:0,normal:0,hard:0,extreme:0}, mastered: [], attempted: []};
                if(!globalStats.mastered) globalStats.mastered = [];
                if(!globalStats.attempted) globalStats.attempted = [];
                if (importedData.state) { localStorage.setItem('exam_state', JSON.stringify(importedData.state)); } else { localStorage.removeItem('exam_state'); }
            } else { banks = importedData; }
            saveBanks(); saveGlobalStats(); setNeedSync(true); alert(`✅ 成功从本地文件全量覆盖恢复！`); location.reload();
        } catch(err) { alert("文件解析错误。"); }
    }; reader.readAsText(file); event.target.value = '';
};

function parseInput() {
    let raw = document.getElementById('data-input').value; if (!raw.trim()) { alert("请先粘贴题库数据"); return null; }
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim(); raw = raw.replace(/[\u200B-\u200D\uFEFF]/g, '');
    try { 
        let data = JSON.parse(raw); 
        if(!Array.isArray(data) || data.length === 0) { alert("必须是非空的数组格式 [ ]"); return null; }
        
        let missingAnsCount = 0; let invalidFormatCount = 0;
        for(let i = 0; i < data.length; i++) {
            let q = data[i];
            if(!q.question || !q.options || q.answer === undefined) { invalidFormatCount++; continue; }
            if(q.answer.trim() === "") { missingAnsCount++; }
        }
        if(invalidFormatCount > 0) { alert(`❌ 格式错误：检测到 ${invalidFormatCount} 道题目缺乏必要字段(question/options/answer)，请检查代码格式。`); return null; }
        if(missingAnsCount > 0) { alert(`🚨 导入拦截：检测到有 ${missingAnsCount} 道题目没有提供正确答案 ("answer" 为空)！\n\n为了防止系统判分崩溃或产生死数据，请先补齐正确字母选项后再导入。`); return null; }
        return data; 
    } catch(e) { alert("JSON 解析失败，请检查是否有多余的符号：" + e.message); return null; }
}

window.saveNewBank = function() {
    let qs = parseInput(); if(!qs) return; let name = document.getElementById('new-bank-name').value.trim(); if(!name) return alert("请命名");
    let id = 'bank_' + Date.now(); banks[id] = { name: name, data: qs, completed: false, maxRate: 0 }; 
    saveBanks(); renderBankList(); initUIState();
    document.getElementById('data-input').value = ''; document.getElementById('new-bank-name').value = ''; alert(`✅ 保存成功！`);
};
window.appendToBank = function() {
    let qs = parseInput(); if(!qs) return; let bankId = document.getElementById('exist-bank-select').value; if(!bankId) return alert("请选择题库");
    if(banks[bankId] && banks[bankId].isSystem) return alert("系统题库不可手动追加！");
    let bank = banks[bankId]; let existFps = new Set(bank.data.map(q => getFingerprint(q.question))); let added = 0; let dup = 0;
    qs.forEach(q => { let fp = getFingerprint(q.question); if(!existFps.has(fp)) { bank.data.push(q); existFps.add(fp); added++; } else { dup++; } });
    bank.completed = false; bank.maxRate = 0;
    saveBanks(); renderBankList(); document.getElementById('data-input').value = ''; alert(`✅ 新增 ${added} 道，拦截重复 ${dup} 道。印章已重置！`);
};
window.deleteBank = function(id) {
    if(banks[id] && banks[id].isSystem) return alert("系统题库不可删除！");
    if(confirm(`确定删除吗？`)) { delete banks[id]; saveBanks(); if (localStorage.getItem('exam_state') && JSON.parse(localStorage.getItem('exam_state')).bankId === id) localStorage.removeItem('exam_state'); renderBankList(); initUIState();}
};

function renderBankList() {
    const sysList = document.getElementById('sys-bank-list'); const customList = document.getElementById('bank-list'); const sel = document.getElementById('exist-bank-select');
    sysList.innerHTML = ''; customList.innerHTML = ''; sel.innerHTML = '<option value="">-- 追加至目标题库 --</option>'; let hasCustomBanks = false;
    
    ['sys_wrong', 'sys_star'].forEach(id => {
        let b = banks[id]; if(!b || !b.data) return;
        let div = document.createElement('div'); div.className = `bank-item bank-sys-${b.sysType}`;
        let savedState = JSON.parse(localStorage.getItem('exam_state') || 'null'); let hasResume = (savedState && savedState.bankId === id);
        let playBtnTxt = hasResume ? '继续清剿' : '开始攻克'; let playBtnClass = b.data.length === 0 ? 'btn disabled' : (hasResume ? 'btn-primary' : 'btn');
        div.innerHTML = `
            <div class="bank-header-row"><div class="bank-title">${b.name}</div></div>
            <div class="bank-meta-row"><span class="bank-meta-tag">收录 ${b.data.length} 题</span></div>
            <button class="btn ${playBtnClass}" style="margin-bottom:0; margin-top:4px;" ${b.data.length===0?'disabled':''} onclick="startQuiz('${id}', ${hasResume})">${b.data.length===0?'当前暂无数据':playBtnTxt}</button>
        `; sysList.appendChild(div);
    });

    for (let id in banks) {
        if(!banks[id] || !banks[id].data) continue;
        if(banks[id].isSystem) continue;
        hasCustomBanks = true; let b = banks[id];
        let opt = document.createElement('option'); opt.value = id; opt.innerText = b.name; sel.appendChild(opt);
        let div = document.createElement('div'); div.className = b.completed ? 'bank-item bank-completed' : 'bank-item';
        let savedState = JSON.parse(localStorage.getItem('exam_state') || 'null'); let hasResume = (savedState && savedState.bankId === id);
        let playBtnTxt = hasResume ? '继续作答' : '开始作答'; let playBtnClass = hasResume ? 'btn-primary' : 'btn';
        let stampHtml = b.completed ? `<div class="stamp-completed">已完成</div>` : '';
        div.innerHTML = `
            ${stampHtml}
            <div class="bank-header-row"><div class="bank-title">${b.name}</div><div class="bank-delete-text" onclick="deleteBank('${id}')">删除</div></div>
            <div class="bank-meta-row">
                <span class="bank-meta-tag">共 ${b.data.length} 题</span>
                <span class="bank-meta-tag highlight">★ 最高 ${b.maxRate || 0}%</span>
            </div>
            <button class="btn ${playBtnClass}" style="margin-bottom:0; margin-top:4px;" onclick="startQuiz('${id}', ${hasResume})">${playBtnTxt}</button>
        `; customList.appendChild(div);
    }
    if(!hasCustomBanks) customList.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:24px; font-size:14px; border:2px dashed #cbd5e1; border-radius:16px; font-weight:700;">您的自定义题库空空如也，请前往左上角菜单 [⚙️ 控制面板] 导入。</div>';
}

function saveState() {
    if(App.isChallenge || isTestMode) return;
    const state = { bankId: App.bankId, current: App.current, score: App.score, mode: App.mode, wrongList: App.wrongList, stars: Array.from(App.stars), isAnswered: App.isAnswered, selected: App.selected, activeData: App.data, timerMode: App.timerMode, timeRemaining: App.timeRemaining, optShuffle: App.optShuffle };
    localStorage.setItem('exam_state', JSON.stringify(state));
}

function preprocessOptions(dataArray, isShuffle) {
    dataArray.forEach(q => {
        let dKeys = Object.keys(q.options).sort(); q.optMap = {}; 
        if (isShuffle) {
            let oKeys = [...dKeys]; for (let i = oKeys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [oKeys[i], oKeys[j]] = [oKeys[j], oKeys[i]]; }
            dKeys.forEach((dk, i) => { q.optMap[dk] = oKeys[i]; });
        } else { dKeys.forEach(dk => { q.optMap[dk] = dk; }); }
    });
}

function blockShuffle(array) {
    let independent = []; let groups = {};
    array.forEach(q => { if (q.groupId) { if (!groups[q.groupId]) groups[q.groupId] = []; groups[q.groupId].push(q); } else { independent.push(q); } });
    let blocks = []; independent.forEach(q => blocks.push([q])); 
    for (let gid in groups) { blocks.push(groups[gid]); }
    for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
    let result = []; blocks.forEach(block => result.push(...block)); return result;
}

function launchQuizEngine(config) {
    closeDrawer(); 
    App.bankId = config.bankId || null; App.data = config.data; App.isChallenge = config.isChallenge || false; App.challengeDiff = config.challengeDiff || null;
    App.mode = config.mode || 'instant'; App.isCompletedBank = config.isCompletedBank || false; App.isSystemBank = config.isSystemBank || false;
    App.optShuffle = document.getElementById('opt-shuffle-cb') ? document.getElementById('opt-shuffle-cb').checked : false;

    if (config.isResume) {
        let s = config.savedState;
        App.current = s.current; App.score = s.score; App.wrongList = s.wrongList; App.stars = new Set(s.stars); App.isAnswered = s.isAnswered; App.selected = s.selected; App.timerMode = s.timerMode || false; App.timeRemaining = s.timeRemaining || 0; App.optShuffle = s.optShuffle || false;
        App.data.forEach(q => { if(!q.optMap) { q.optMap={}; Object.keys(q.options).sort().forEach(k=>q.optMap[k]=k); }});
    } else {
        preprocessOptions(App.data, App.optShuffle);
        App.current = 0; App.score = 0; App.wrongList = []; App.stars.clear(); App.selected = []; App.isAnswered = false;
        App.timerMode = config.timerMode || false; App.timeRemaining = config.timeRemaining || 0;
    }

    Router.navigate('page-quiz');
    
    document.getElementById('nav-btn-back').innerText = App.isChallenge ? '〈 放弃挑战 (判负)' : '〈 保存并退出'; 
    document.getElementById('btn-quit').innerText = App.isChallenge ? '投降退出' : '放弃当前进度，清空重卷';
    
    if(App.timerMode) { document.getElementById('timer-display').classList.remove('hidden'); startTimerLogic(); } else { document.getElementById('timer-display').classList.add('hidden'); }
    renderQuestion(config.isResume);
}

window.startChallenge = function(difficulty) {
    let totalQ = parseInt(document.getElementById('global-total-q').innerText);
    let reqQ = UNLOCK_REQS_Q[difficulty]; let reqC = UNLOCK_REQS_C[difficulty]; let preReqMode = UNLOCK_PRE[difficulty];
    if(totalQ < reqQ || globalStats.totalCorrect < reqC || (preReqMode ? (globalStats.challenge[preReqMode] || 0) < 1 : false)) return alert(`🔒 挑战受限！请先满足解锁条件。`);
    
    let reqMap = { 'easy': 10, 'normal': 30, 'hard': 60, 'extreme': 90 }; let req = reqMap[difficulty];
    let priorityQs = []; let priorityFps = new Set();
    if (banks['sys_wrong'] && banks['sys_wrong'].data) banks['sys_wrong'].data.forEach(q => { let fp = getFingerprint(q.question); if(!priorityFps.has(fp)) { priorityQs.push(q); priorityFps.add(fp); } });
    if (banks['sys_star'] && banks['sys_star'].data) banks['sys_star'].data.forEach(q => { let fp = getFingerprint(q.question); if(!priorityFps.has(fp)) { priorityQs.push(q); priorityFps.add(fp); } });
    
    priorityQs = blockShuffle(priorityQs);
    let regularQs = []; 
    for(let id in banks) { if(banks[id] && banks[id].data && !banks[id].isSystem) { banks[id].data.forEach(q => { let fp = getFingerprint(q.question); if(!priorityFps.has(fp)) { regularQs.push(q); } }); } }
    regularQs = blockShuffle(regularQs);

    let finalQs = [].concat(priorityQs.slice(0, Math.min(priorityQs.length, req)));
    if (req - finalQs.length > 0) finalQs = finalQs.concat(regularQs.slice(0, req - finalQs.length));
    finalQs = blockShuffle(finalQs); 

    launchQuizEngine({ data: finalQs, isChallenge: true, challengeDiff: difficulty, mode: 'exam', timerMode: difficulty === 'extreme', timeRemaining: difficulty === 'extreme' ? 90 * 60 : 0 });
};

window.startQuiz = function(bankId, isResume) {
    let config = { bankId: bankId, isCompletedBank: banks[bankId].completed || false, isSystemBank: banks[bankId].isSystem || false };
    if (isResume) {
        config.isResume = true; config.savedState = JSON.parse(localStorage.getItem('exam_state')); config.data = config.savedState.activeData;
    } else {
        config.data = JSON.parse(JSON.stringify(banks[bankId].data));
        if (document.getElementById('shuffle-cb').checked) { config.data = blockShuffle(config.data); }
        config.mode = document.querySelector('input[name="mode"]:checked').value;
        config.timerMode = document.getElementById('timer-cb').checked;
        config.timeRemaining = config.timerMode ? (parseInt(document.getElementById('timer-minutes').value) || 30) * 60 : 0;
    }
    launchQuizEngine(config);
};

function startTimerLogic() {
    if(timerInterval) clearInterval(timerInterval); updateTimerUI();
    timerInterval = setInterval(() => {
        if(App.timeRemaining > 0) { App.timeRemaining--; updateTimerUI(); if(App.timeRemaining % 5 === 0 && !App.isChallenge) saveState(); } 
        else { clearInterval(timerInterval); alert(App.isChallenge ? "💀 时间耗尽！挑战失败！" : "⏱️ 考试时间结束！系统已自动交卷。"); showResult(); }
    }, 1000);
}
function updateTimerUI() {
    let m = Math.floor(App.timeRemaining / 60).toString().padStart(2, '0'); let s = (App.timeRemaining % 60).toString().padStart(2, '0');
    document.getElementById('timer-display').innerText = `⏳ 倒计时 ${m}:${s}`;
}

window.giveUpQuiz = function() { 
    if(App.isChallenge) { if(confirm("💀 确定要投降吗？逃跑将被视为挑战失败！")) { if(timerInterval) clearInterval(timerInterval); location.reload(); } } 
    else { if(confirm("⚠️ 确定要清空重来吗？本次进度将被删除。")) { if(timerInterval) clearInterval(timerInterval); localStorage.removeItem('exam_state'); location.reload(); } }
};

function renderQuestion(isRestore = false) {
    if (!isRestore) { App.selected = []; App.isAnswered = false; }
    const q = App.data[App.current]; 
    document.getElementById('progress-text').innerText = `${App.current + 1} / ${App.data.length}`;
    document.getElementById('progress-fill').style.width = (((App.current) / App.data.length) * 100) + '%';
    
    let completedNote = App.isCompletedBank ? `<span style="color:#ef4444; font-size:12px; margin-left:8px;">[此题库已达100%，作答不计入大盘]</span>` : '';
    let sourceHtml = q.source ? `<span class="source-text">📄 出处：${q.source}</span>` : '';
    
    let rawQ = q.question; let displayQ = rawQ; let matRegex = /\[材料原文[：:]([\s\S]*?)\]([\s\S]*)/; let match = rawQ.match(matRegex);
    
    let matContainer = document.getElementById('material-container'); matContainer.innerHTML = '';
    if (match) {
        let matText = match[1].trim(); displayQ = match[2].trim();
        matContainer.innerHTML = `
            <div class="material-box">
                <div class="material-content collapsed" id="mat-content">
                    <div style="font-weight:900; color:#1e293b; margin-bottom:8px;">📖 阅读材料</div>
                    <div style="white-space: pre-wrap; text-align: justify; font-size: 14.5px; font-weight: normal;">${matText}</div>
                </div>
                <div class="material-fade" id="mat-fade"></div>
                <div class="material-toggle" id="mat-toggle" onclick="toggleMaterial(this)">📄 展开阅读完整材料 ▼</div>
            </div>
        `;
        setTimeout(() => {
            let content = document.getElementById('mat-content');
            if (content && content.scrollHeight <= 100) { document.getElementById('mat-fade').style.display = 'none'; document.getElementById('mat-toggle').style.display = 'none'; content.classList.remove('collapsed'); }
        }, 50);
    }

    document.getElementById('question-text').innerHTML = `<span class="badge">${q.type === 'multiple' ? '多选题' : '单选题'}</span> <span style="font-weight:800;">${displayQ}</span> ${completedNote} ${sourceHtml}`;
    
    let isStarred = banks['sys_star'] && banks['sys_star'].data && banks['sys_star'].data.some(x => getFingerprint(x.question) === getFingerprint(q.question));
    let btnStar = document.getElementById('btn-star');
    btnStar.innerHTML = isStarred ? '★ 已收藏' : '☆ 收藏本题'; btnStar.className = isStarred ? 'nav-btn bookmark-btn active' : 'nav-btn bookmark-btn';
    
    let optsContainer = document.getElementById('options-container'); optsContainer.innerHTML = '';
    let dKeys = Object.keys(q.optMap).sort();
    for (let dk of dKeys) { 
        let oKey = q.optMap[dk]; 
        let btn = document.createElement('button'); btn.className = 'opt-btn'; btn.id = `opt-${oKey}`; 
        btn.innerHTML = `<span class="opt-letter">${dk}.</span> <span>${q.options[oKey]}</span>`; 
        btn.onclick = () => selectOpt(oKey, q.type); optsContainer.appendChild(btn); 
    }
    
    let feedback = document.getElementById('feedback-box'); let btnAction = document.getElementById('btn-action');
    feedback.classList.add('hidden'); btnAction.className = "btn btn-primary";
    btnAction.innerText = App.mode === 'instant' ? '确认选择' : (App.current === App.data.length - 1 ? (App.isChallenge?'斩杀！查看战果':'交卷并查看成绩') : '下一题');
    if (isRestore && App.isAnswered) { restoreFeedback(); } else if (isRestore && App.selected.length > 0) { App.selected.forEach(k => { let b = document.getElementById(`opt-${k}`); if(b) b.classList.add('selected'); }); }
    saveState();
}

function selectOpt(key, type) {
    if (App.isAnswered) return;
    if (type === 'single') { App.selected = [key]; document.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected')); document.getElementById(`opt-${key}`).classList.add('selected'); } 
    else { let idx = App.selected.indexOf(key); if (idx > -1) { App.selected.splice(idx, 1); document.getElementById(`opt-${key}`).classList.remove('selected'); } else { App.selected.push(key); document.getElementById(`opt-${key}`).classList.add('selected'); } }
    saveState();
}

window.toggleStar = function() {
    const q = App.data[App.current]; const fp = getFingerprint(q.question); let starBank = banks['sys_star'];
    let isStarred = starBank.data.some(x => getFingerprint(x.question) === fp);
    let btnStar = document.getElementById('btn-star');
    if (isStarred) {
        starBank.data = starBank.data.filter(x => getFingerprint(x.question) !== fp);
        btnStar.innerHTML = '☆ 收藏本题'; btnStar.className = 'nav-btn bookmark-btn';
    } else {
        starBank.data.push(cleanQuestionForStorage(q));
        btnStar.innerHTML = '★ 已收藏'; btnStar.className = 'nav-btn bookmark-btn active';
    }
    saveBanks(); saveState();
};

window.handleAction = function() {
    const q = App.data[App.current];
    if (App.mode === 'instant' && !App.isAnswered) { 
        if (!App.selected.length) return alert("请先做出选择哦"); 
        App.isAnswered = true; processAnswer(q); showFeedbackUI(q); 
        let btnAction = document.getElementById('btn-action'); btnAction.className = "btn"; btnAction.innerText = App.current === App.data.length - 1 ? '查看练习报告' : '进入下一题'; saveState(); return; 
    }
    if (App.mode === 'exam') { if (!App.selected.length && !confirm(App.isChallenge?"还在挑战中，确定要空白跳过吗？":"确定要跳过此题吗？")) return; processAnswer(q); }
    App.current++; App.current >= App.data.length ? showResult() : renderQuestion(false);
};

function processAnswer(q) {
    let myAns = App.selected.sort().join(''); let rightAns = q.answer.split('').sort().join(''); let isRight = (myAns === rightAns);
    let fp = getFingerprint(q.question); let wrongBank = banks['sys_wrong'];
    let isStarred = banks['sys_star'] && banks['sys_star'].data && banks['sys_star'].data.some(x => getFingerprint(x.question) === fp);
    let fpHash = getHash(fp);

    if(!App.isChallenge && !App.isCompletedBank && !App.isSystemBank && !isTestMode) { 
        if(!globalStats.attempted.includes(fpHash)) { globalStats.attempted.push(fpHash); globalStats.totalAnswered++; }
    }

    if (isRight) {
        App.score++; 
        if(!App.isChallenge && !App.isCompletedBank && !App.isSystemBank && !isTestMode) { 
            if(!globalStats.mastered.includes(fpHash)) { globalStats.mastered.push(fpHash); globalStats.totalCorrect++; }
        }
        if(App.bankId === 'sys_wrong') { wrongBank.data = wrongBank.data.filter(x => getFingerprint(x.question) !== fp); saveBanks(); }
    } else {
        let alreadyInWrong = wrongBank.data.some(x => getFingerprint(x.question) === fp);
        if (!alreadyInWrong && !isTestMode) { wrongBank.data.push(cleanQuestionForStorage(q)); saveBanks(); }
    }
    
    if (!isRight || isStarred) App.wrongList.push({ id: q.id, q: q.question, options: q.options, source: q.source || "未知", my: myAns || "未答", right: q.answer, reason: !isRight ? "答错" : "收藏" });
    if(!App.isChallenge && !App.isCompletedBank && !App.isSystemBank && !isTestMode) { saveGlobalStats(); }
}

function showFeedbackUI(q) {
    let myAns = App.selected.sort().join('');
    document.querySelectorAll('.opt-btn').forEach(btn => { 
        btn.classList.add('locked'); let k = btn.id.replace('opt-', ''); 
        if (q.answer.includes(k)) btn.classList.add('correct'); else if (myAns.includes(k) && !q.answer.includes(k)) btn.classList.add('wrong'); 
    });
    let feedback = document.getElementById('feedback-box');
    feedback.classList.remove('hidden');
    if (myAns === q.answer.split('').sort().join('')) { 
        feedback.style.background = '#f0fdf4'; feedback.style.color = '#166534'; feedback.style.border = "2px solid #6ee7b7"; feedback.innerHTML = "✅ 回答完全正确！"; 
    } else { 
        let revMap = {}; for(let dk in q.optMap) { revMap[q.optMap[dk]] = dk; }
        let displayRightAns = q.answer.split('').map(k => revMap[k] || k).sort().join('');
        feedback.style.background = '#fef2f2'; feedback.style.color = '#991b1b'; feedback.style.border = "2px solid #fecaca"; 
        feedback.innerHTML = `❌ 哎呀选错了。正确答案是：<span style="font-size:18px; font-weight:900; margin-left:6px;">${displayRightAns}</span>`; 
    }
}

function restoreFeedback() { const q = App.data[App.current]; App.selected.forEach(k => { let b = document.getElementById(`opt-${k}`); if(b) b.classList.add('selected'); }); showFeedbackUI(q); let btnAction=document.getElementById('btn-action'); btnAction.className = "btn"; btnAction.innerText = App.current === App.data.length - 1 ? '查看练习报告' : '进入下一题'; }

function createParticles() {
    for(let i=0; i<80; i++) {
        let p = document.createElement('div'); p.className = 'particle';
        let colors = ['#f59e0b', '#fbbf24', '#ef4444', '#3b82f6', '#10b981', '#a78bfa']; p.style.background = colors[Math.floor(Math.random() * colors.length)]; p.style.left = (Math.random() * 100) + 'vw'; p.style.top = '100vh'; p.style.animation = `fly ${1 + Math.random()}s cubic-bezier(.25,.46,.45,.94) forwards`; document.body.appendChild(p); setTimeout(() => p.remove(), 2000);
    }
}

function triggerChallengeFeedback(diff, pct) {
    let box = document.getElementById('challenge-feedback'); let title = document.getElementById('cf-title'); let desc = document.getElementById('cf-desc'); box.className = "";
    let diffName = PRE_NAMES[diff]; let isEpic = false;

    if (pct < 0.5) {
        box.classList.add('cf-bronze'); title.innerText = "💀 挑战失败"; title.style.color = "#ef4444"; desc.innerText = `你在【${diffName}】模式下正确率未达50%，已被无情淘汰。再接再厉！`;
    } else {
        if(!isTestMode) { globalStats.challenge[diff]++; saveGlobalStats(); }
        if(pct === 1) {
            box.classList.add('cf-gold'); title.innerText = "🏆 完美通关！神级操作！"; desc.innerText = `你在【${diffName}】模式下一题未错，绝对的碾压局！荣誉神殿已为你刻上勋章！`;
            if(diff === 'extreme') { document.body.classList.add('anim-shake'); setTimeout(()=>document.body.classList.remove('anim-shake'), 500); title.classList.add('text-rainbow'); box.classList.add('anim-glow'); createParticles(); isEpic = true; } 
            else if(diff === 'hard') { box.classList.add('anim-glow'); isEpic = true; }
            else { isEpic = true; }
        } else if (pct >= 0.8) {
            box.classList.add('cf-silver'); title.innerText = "✨ 卓越表现！成功斩杀！"; desc.innerText = `你在【${diffName}】模式下发挥出色，荣誉神殿已为你刻上勋章！`;
            if(diff === 'extreme') isEpic = true;
        } else {
            box.classList.add('cf-bronze'); title.innerText = "🎉 挑战成功！惊险过关！"; title.style.color = "#059669"; desc.innerText = `你在【${diffName}】模式下达到了及格线，荣誉神殿已为你刻上勋章！`;
        }
    }
    return isEpic;
}

window.showResult = function() {
    if(timerInterval) clearInterval(timerInterval); if(!App.isChallenge) localStorage.removeItem('exam_state'); 
    Router.navigate('page-result');
    
    let reportSnapshot = { score: App.score, total: App.data.length, wrongList: App.wrongList, isChallenge: App.isChallenge, challengeDiff: App.challengeDiff, bankId: App.bankId, isSystemBank: App.isSystemBank };
    localStorage.setItem('exam_last_report', JSON.stringify(reportSnapshot));

    let pct = App.score / App.data.length; let pctStr = Math.round(pct * 100);
    document.getElementById('score-text').innerText = `${App.score} / ${App.data.length} (${pctStr}%)`;
    
    let epicTriggered = false; let epicTitle = ""; let epicDesc = "";

    if (!App.isChallenge) {
        let completeMsg = "";
        if(!isTestMode && !App.isSystemBank) {
            let b = banks[App.bankId];
            if (!b.maxRate || pctStr > b.maxRate) b.maxRate = pctStr;
            if (pctStr === 100 && !b.completed) {
                b.completed = true; completeMsg = "<br><span style='color:#ef4444; font-weight:900; font-size:16px;'>🎉 恭喜！您已100%拿下此题库，获得毕业印章！</span>";
                epicTriggered = true; epicTitle = `🏆 题库 ${b.name} 满分毕业`; epicDesc = "您已 100% 攻克此题库并获得红章。这项伟大的心血进度，是否立即为您安全封存至 GitHub 云端？";
            } else if (b.completed) { completeMsg = "<br><span style='color:#64748b;'>（此题库已毕业，本次不增加大盘数值）</span>"; }
            saveBanks();
        } else if (App.isSystemBank) { completeMsg = "<br><span style='color:#f59e0b;'>（系统题库不计入大盘数据，错题答对已自动销毁）</span>"; }
        
        document.getElementById('result-page-title').innerText = "练习战报"; document.getElementById('challenge-feedback').classList.add('hidden'); 
        document.getElementById('stat-text').innerHTML = `本次作答 ${App.data.length} 题 | 收录错题 ${App.wrongList.length} 题${completeMsg}`;
    } else {
        document.getElementById('result-page-title').innerText = "⚔️ 竞技场战报"; document.getElementById('stat-text').innerText = `本次极限操作：${App.data.length} 题 | 期间所有错题已全自动收录至错题本`;
        let isEpic = triggerChallengeFeedback(App.challengeDiff, pct);
        if(isEpic) { epicTriggered = true; epicTitle = `🔥 竞技场无上荣耀`; epicDesc = "您刚刚在竞技场中斩获了惊人的战绩，荣誉神殿已更新。强烈建议您立即将这份荣耀永远封存于云端！"; }
    }
    renderChunks();
    
    if(epicTriggered && !isTestMode) { setTimeout(() => { showEpicModal(epicTitle, epicDesc); }, 1200); }
};

window.restoreLastReport = function() {
    let snapshotStr = localStorage.getItem('exam_last_report'); if(!snapshotStr) return;
    let snapshot = JSON.parse(snapshotStr);
    App.score = snapshot.score; App.data = new Array(snapshot.total); App.wrongList = snapshot.wrongList; App.isChallenge = snapshot.isChallenge; App.challengeDiff = snapshot.challengeDiff; App.bankId = snapshot.bankId; App.isSystemBank = snapshot.isSystemBank;

    Router.navigate('page-result');

    let pctStr = Math.round((App.score / snapshot.total) * 100);
    document.getElementById('score-text').innerText = `${App.score} / ${snapshot.total} (${pctStr}%)`;
    document.getElementById('result-page-title').innerText = App.isChallenge ? "⚔️ 竞技场战报 (快照恢复)" : "练习战报 (快照恢复)";
    let statHtml = App.isChallenge ? `本次极限操作：${snapshot.total} 题 | 期间所有错题已全自动收录至错题本` : `本次作答 ${snapshot.total} 题 | 收录错题 ${App.wrongList.length} 题 <br><span style='color:#f59e0b;'>（此为本地战报快照驻留，大盘数据已在之前结算时安全记录）</span>`;
    document.getElementById('stat-text').innerHTML = statHtml; document.getElementById('challenge-feedback').classList.add('hidden');
    renderChunks();
};

window.dismissLastReport = function() { localStorage.removeItem('exam_last_report'); document.getElementById('recovery-banner').classList.add('hidden'); };
window.clearReportAndReload = function() { localStorage.removeItem('exam_last_report'); location.reload(); };

window.renderChunks = function() {
    const container = document.getElementById('chunks-container'); container.innerHTML = '';
    if (App.wrongList.length === 0) { container.innerHTML = "<div class='chunk-box' style='text-align:center; color:#10b981; background:#ecfdf5; border-color:#6ee7b7;'>✨ 恭喜，本次练习全对，完美通关！</div>"; return; }
    let chunkSize = parseInt(document.getElementById('chunk-size-input').value) || 5; if (chunkSize < 1) chunkSize = 1;
    for (let i = 0, batch = 1; i < App.wrongList.length; i += chunkSize, batch++) {
        let chunk = App.wrongList.slice(i, i + chunkSize); 
        let text = `【考试助手 - 错题深度解析请求 (第 ${batch} 批)】\n请作为我的专属导师，结合出处文件，严格按结构为我深度解析以下错题：\n\n`;
        chunk.forEach((item, index) => { 
            let isCorrect = (item.my === item.right); let myStatus = isCorrect ? "✅ (作答正确，但已收藏求深度解析)" : "❌";
            let optStr = ""; if(item.options) { Object.keys(item.options).sort().forEach(k => { optStr += `${k}. ${item.options[k]}   `; }); }
            text += `### 📝 题目 ${index + 1}\n- **题干**: ${item.q}\n- **选项**: ${optStr || '无选项信息'}\n`;
            if(item.source && item.source !== '未知') text += `- **溯源出处**: ${item.source}\n`;
            text += `- **我的作答**: [${item.my || '未答'}] ${myStatus}\n- **官方标答**: [${item.right}] ✅\n\n---\n\n`;
        });
        let div = document.createElement('div'); div.className = 'chunk-box';
        div.innerHTML = `<div class="chunk-title">📝 错题集 - 第 ${batch} 批 (共 ${chunk.length} 题)</div><textarea class="chunk-textarea" id="txt-${batch}" readonly>${text}</textarea><button class="btn btn-primary" style="margin:0; padding:14px; border-radius:12px;" onclick="window.copyRpt(${batch})">复制报告，发送给 AI 助手</button>`;
        container.appendChild(div);
    }
};
window.copyRpt = function(idx) { navigator.clipboard.writeText(document.getElementById(`txt-${idx}`).value).then(() => alert(`✅ 内容已成功复制！`)); };
