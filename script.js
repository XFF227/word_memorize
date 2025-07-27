const API_BASE = 'https://6885b254f52d34140f6a541d.mockapi.io/word_users';  // Base API endpoint for user data
let userId = null;
let wordList = [];    // Array of word objects: {english, chinese, scoreValue, date}
let wrongList = [];   // Array of wrong entry objects: {meaning, correct: [words]}
let data = {};        // Map of meaning -> [wordsArray, meaning] for quiz grouping
let keys = [];        // Array of meaning keys (for iterating questions)
let quizOrder = [];   // Ordered list of keys for quiz questions
let currentIndex = 0; // Index in quizOrder or wrongList for current question
let currentQuestion = null;   // Current meaning key being tested
let currentCorrect = [];      // Array of correct English words for current question
let wordMap = {};     // Map from English word -> Chinese meaning (for quick lookup)

// Load user data from API and initialize global state
async function loadUserData() {
    const raw = localStorage.getItem("user");
    if (!raw) {
        alert("请先登录！");
        location.href = "login.html";
        return;
    }
    const localUser = JSON.parse(raw);
    const username = localUser.username;
    try {
        // Fetch the user data by username
        const res = await fetch(`${API_BASE}?username=${username}`);
        const users = await res.json();
        if (users.length === 0) {
            alert("用户不存在，请重新登录");
            location.href = "login.html";
            return;
        }
        const user = users[0];
        userId = user.user;  // use ObjectId for identification (primary key)
        // Initialize wordList and wrongList from the user's data
        wordList = user.word_list || [];
        wrongList = user.Wrong_list || [];
        // Build a quick lookup map for word meanings
        wordMap = {};
        wordList.forEach(item => {
            wordMap[item.english] = item.chinese;
        });
        // Build grouped data by Chinese meaning for quiz logic
        buildDataGroups();
        // Render the flashcards view and update quiz options
        renderFlashcards();
        updateQuizOptions();
    } catch (err) {
        console.error("加载用户数据失败：", err);
        alert("加载用户数据失败，请稍后重试");
    }
}

// Save user data (wordList and wrongList) to the server
async function saveUserData() {
    if (!userId) return;
    try {
        await fetch(`${API_BASE}/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word_list: wordList,
                Wrong_list: wrongList
            })
        });
    } catch (err) {
        console.error("保存用户数据失败：", err);
        // Note: In a real app, handle save errors (e.g., retry or alert user)
    }
}

// Group the words by Chinese meaning into the global 'data' structure
function buildDataGroups() {
    data = {};
    wordList.forEach(word => {
        const meaning = word.chinese;
        const english = word.english;
        if (!data[meaning]) {
            data[meaning] = [[], meaning];
        }
        data[meaning][0].push(english);
    });
    keys = Object.keys(data);
}

// Render flashcards: display words grouped by date, sorted by scoreValue
function renderFlashcards() {
    const container = document.getElementById('cardsContainer');
    // Group words by their date
    const groupsByDate = {};
    wordList.forEach(word => {
        const date = word.date || '未指定日期';
        if (!groupsByDate[date]) {
            groupsByDate[date] = [];
        }
        groupsByDate[date].push(word);
    });
    // Sort dates (newest first)
    const dates = Object.keys(groupsByDate).sort((a, b) => b.localeCompare(a));
    // Build HTML for each date group
    let html = '';
    dates.forEach(date => {
        const words = groupsByDate[date];
        // Sort words by scoreValue ascending
        words.sort((a, b) => (a.scoreValue ?? 0) - (b.scoreValue ?? 0));
        html += `<div class="card">`;
        html += `<strong>${date}</strong><br>`;
        // List each word with its Chinese meaning, colored by score
        words.forEach((w, index) => {
            const colorSpan = `<span style="color:${getColor(w.scoreValue ?? 0)}">${w.english}</span>`;
            html += `${colorSpan} - ${w.chinese}`;
            if (index < words.length - 1) html += '<br>';
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}

// Populate the quiz selection dropdown with date options
function updateQuizOptions() {
    const select = document.getElementById('quizSelect');
    // Remove any existing date options (keep the "negative" option)
    // (Option at index 0 is "negative")
    for (let i = select.options.length - 1; i >= 1; i--) {
        select.remove(i);
    }
    // Get unique dates from wordList
    const dates = [...new Set(wordList.map(w => w.date).filter(d => d))];
    dates.sort((a, b) => a.localeCompare(b));  // sort dates ascending for dropdown
    dates.forEach(date => {
        const opt = document.createElement('option');
        opt.value = date;
        opt.textContent = `仅练习 ${date} 的单词`;
        select.appendChild(opt);
    });
}

// Start the quiz based on selected scope (date or all negative)
function startQuiz() {
    const select = document.getElementById('quizSelect');
    const choice = select.value;
    // Build quiz order keys depending on choice
    let selectedKeys = [];
    if (choice === 'negative') {
        // All meaning groups that have any word with scoreValue < 0
        selectedKeys = keys.filter(k => {
            return data[k][0].some(word => {
                // if any word in this meaning group has score < 0
                const score = getWordScore(word);
                return score < 0;
            });
        });
    } else {
        // A specific date: include only meaning groups of words from that date
        selectedKeys = keys.filter(k => {
            return data[k][0].some(word => {
                const w = wordList.find(obj => obj.english === word);
                return w && w.date === choice;
            });
        });
    }
    // If no words match the selection, alert and return
    if (selectedKeys.length === 0) {
        alert("没有符合条件的单词可供练习！");
        return;
    }
    // Order the keys by priority (words with lowest scores first):contentReference[oaicite:36]{index=36}
    selectedKeys.sort((a, b) => {
        // Compare the minimum score of each meaning group
        const minA = Math.min(...data[a][0].map(w => getWordScore(w) ?? 0));
        const minB = Math.min(...data[b][0].map(w => getWordScore(w) ?? 0));
        return minA - minB;
    });
    quizOrder = selectedKeys;
    currentIndex = 0;
    document.getElementById('quizArea').innerHTML = ''; // clear previous content
    nextQuiz();
}

// Display the next question in the quiz
/** 1. nextQuiz(): 出题，显示英文词干 + 4 个英文选项（仅 1 个正确同义词） */



// Start reviewing wrong-list words
function startWrongReview() {
    currentIndex = 0;
    // Hide the static wrong list display and clear any leftover question
    document.getElementById('wrongCards').style.display = 'none';
    document.getElementById('wrongArea').innerHTML = '';
    nextWrong();
}

// Display the next question from the wrong list
/** 4. nextWrong(): 错题模式同样改成 “英文→四选一英文同义词” 题型 */

// Record a wrong answer: add to wrongList (if not already present), then save data:contentReference[oaicite:50]{index=50}
async function recordWrong(meaning, correctWords) {
    // Avoid duplicate entries for the same meaning
    if (!wrongList.some(q => q.meaning === meaning)) {
        wrongList.push({ meaning: meaning, correct: [...correctWords] });
    }
    await saveUserData();
}

// Remove a wrong-list entry at given index (called by "删除本题" button)
async function removeWrong(index) {
    wrongList.splice(index, 1);
    await saveUserData();
    // Adjust currentIndex to account for removal
    currentIndex = Math.max(0, currentIndex - 1);
    // Refresh wrong question list or end if none left
    if (currentIndex < wrongList.length) {
        nextWrong();
    } else {
        document.getElementById('wrongArea').innerHTML = '<p>错题训练结束！</p>';
    }
}

// Exit the wrong review mode early
function exitWrongReview() {
    document.getElementById('wrongArea').innerHTML = '';
    document.getElementById('wrongCards').style.display = 'block';
}

// "I don't know" in quiz mode: treat as wrong answer immediately:contentReference[oaicite:51]{index=51}:contentReference[oaicite:52]{index=52}
/** 3. iDontKnow(): “我不会” 视同答错，只高亮正确选项并记录错题 */

// Update the score of given words by delta (increment or decrement):contentReference[oaicite:53]{index=53}
async function updateScore(words, delta) {
    words.forEach(word => {
        // Find the word object in wordList and update its scoreValue
        const w = wordList.find(item => item.english === word);
        if (w) {
            w.scoreValue = (w.scoreValue ?? 0) + delta;
        }
    });
    await saveUserData();
}

// Utility: get a word's current score from wordList or 0 if not found
function getWordScore(word) {
    const w = wordList.find(item => item.english === word);
    return w ? (w.scoreValue ?? 0) : 0;
}

// Utility: determine color based on score value (same thresholds as original):contentReference[oaicite:54]{index=54}
function getColor(score) {
    if (score <= -5) return 'red';
    if (score <= -3) return 'orange';
    if (score < 0)  return 'orange';
    if (score === 0) return 'black';
    if (score <= 3) return 'blue';
    return 'green';
}

// Utility: get mastery level name based on score (optional feature)
function getLevelName(score) {
    if (score <= -5) return '很差';
    if (score <= -3) return '较差';
    if (score < 0)  return '稍差';
    if (score === 0) return '中等';
    if (score <= 3) return '良好';
    return '精通';
}

// Utility: return a colored word span (for flashcard display)
function colorWord(word) {
    const score = getWordScore(word);
    return `<span style="color:${getColor(score)}">${word}</span>`;
}

// Utility: return plain word (for quiz options text)
function plainWord(word) {
    return word;
}

// Highlight the correct Chinese meaning and, if applicable, the wrong selection:contentReference[oaicite:55]{index=55}
function highlightChinese(correctKey, selectedKey, prefix) {
    const correctLabel = document.getElementById(`${prefix}_${correctKey}`);
    const selectedLabel = document.getElementById(`${prefix}_${selectedKey}`);
    if (correctLabel) correctLabel.style.background = '#c8f7c5';   // correct: green
    if (selectedKey !== correctKey && selectedLabel) {
        selectedLabel.style.background = '#f8d7da'; // wrong: red
    }
}

// Highlight English word options: mark correct ones green, wrong selections red:contentReference[oaicite:56]{index=56}:contentReference[oaicite:57]{index=57}
function highlightEnglish(correctWords, selectedWords, inputName) {
    const inputs = document.querySelectorAll(`input[name="${inputName}"]`);
    // Highlight each selected word: green if it's correct, red if not correct
    selectedWords.forEach(sel => {
        const input = [...inputs].find(i => i.value === sel);
        if (input) {
            input.parentElement.style.background = correctWords.includes(sel) ? '#c8f7c5' : '#f8d7da';
        }
    });
    // Highlight all correct words in green
    inputs.forEach(input => {
        if (correctWords.includes(input.value)) {
            input.parentElement.style.background = '#c8f7c5';
        }
    });
}

// Show the bulk-add modal
function showBulkAddModal() {
    document.getElementById('bulkAddModal').style.display = 'flex';
}

// Close the bulk-add modal
function closeBulkAdd() {
    document.getElementById('bulkAddModal').style.display = 'none';
    document.getElementById('bulkInput').value = '';
}

// Save the words entered in the bulk-add modal
async function saveBulkAdd() {
    const textarea = document.getElementById('bulkInput');
    const text = textarea.value.trim();
    if (!text) {
        closeBulkAdd();
        return;
    }
    const lines = text.split('\n');
    let newWordsAdded = false;
    lines.forEach(line => {
        const parts = line.split(',');
        if (parts.length >= 2) {  // require at least "english, chinese"
            const english = parts[0].trim();
            const chinese = parts[1].trim();
            if (english && chinese) {
                // Avoid adding duplicate words (by English text)
                if (!wordList.some(item => item.english === english)) {
                    const newWord = {
                        english: english,
                        chinese: chinese,
                        scoreValue: 0,
                        date: currentDateString()
                    };
                    wordList.push(newWord);
                    newWordsAdded = true;
                }
            }
        }
    });
    if (newWordsAdded) {
        // Rebuild data structures and update UI
        buildDataGroups();
        await saveUserData();
        renderFlashcards();
        updateQuizOptions();
    }
    closeBulkAdd();
}

// Helper: get current date as YYYY-MM-DD
function currentDateString() {
    const d = new Date();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

// Switch between tabs (flashcards, quiz, wrong)
function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    // If switching to wrong tab, show updated wrong list cards:contentReference[oaicite:58]{index=58}
    if (tabId === 'wrong') {
        const cardBox = document.getElementById('wrongCards');
        cardBox.style.display = 'block';
        cardBox.innerHTML = wrongList.map(q =>
            `<div class="card"><strong>${q.meaning}</strong><br>` +
            q.correct.map(word => colorWord(word)).join(', ') +
            `</div>`
        ).join('');
    }
}

// On page load: load data and setup page
window.onload = async function() {
    await loadUserData();
};



/** submitAnswer(): 检查中文选项是否正确，答对自动跳转下一题，答错入错题集 */
function submitAnswer() {
    const sel = document.querySelector("input[name='quiz_choice']:checked");
    if (!sel) {
        alert('请选择一个中文释义');
        return;
    }
    const chosen = sel.value;
    const correct = data[currentQuestion][1];
    const questionWord = data[currentQuestion][0][0]; // 英文题干

    // 高亮中文选项：正确绿，错误红
    highlightChinese(currentQuestion, chosen, 'chinese');

    // 判断并计分/错题
    if (chosen === correct) {
        updateScore([ questionWord ], +1);
        // 自动下一题
        setTimeout(() => {
            // 如果到末尾则清空
            if (currentIndex >= quizOrder.length) {
                document.getElementById('quizArea').innerHTML = '<p>做题结束！</p>';
            } else {
                nextQuiz();
            }
        }, 500);
    } else {
        updateScore([ questionWord ], -1);
        recordWrong(currentQuestion, [ questionWord ]);
        document.getElementById('nextQuizBtn').style.display = 'inline-block';
    }
}
/** iDontKnow(): 我不会时高亮正确项并记录错题，随后点击“下一题” */
function iDontKnow() {
    const correct = data[currentQuestion][1];
    const questionWord = data[currentQuestion][0][0];
    // 高亮正确选项
    highlightChinese(currentQuestion, correct, 'chinese');
    // 扣分并记录错题
    updateScore([ questionWord ], -1);
    recordWrong(currentQuestion, [ questionWord ]);
    document.getElementById('nextQuizBtn').style.display = 'inline-block';
}
/* ========== 新增全局变量 ========== */
let quizIdx = 0, quizWord = null;
let wrongIdx = 0;

/* ========== 修改 nextQuiz()，记录题目并添加“删除本题”按钮 ========== */
function nextQuiz() {
    const container = document.getElementById('quizArea');
    container.innerHTML = '';

    if (currentIndex >= quizOrder.length) {
        container.innerHTML = '<p>做题结束！</p>';
        return;
    }

    // 题号
    const total = quizOrder.length, num = currentIndex + 1;
    container.innerHTML = `<div style="margin-bottom:0.5em;">第 ${num} 题 / 共 ${total} 题</div>`;

    // 获取 key 与正确释义
    const meaningKey    = quizOrder[currentIndex++];
    currentQuestion     = meaningKey;
    const correctChinese = data[meaningKey][1];

    // 英文题干 & 记录索引
    quizWord = data[meaningKey][0][0];
    quizIdx  = currentIndex - 1;

    // 干扰项...
    const otherMeanings = keys.filter(k => k !== meaningKey).map(k => data[k][1]);
    const distractors   = [];
    while (distractors.length < 3 && otherMeanings.length) {
        const idx = Math.floor(Math.random() * otherMeanings.length);
        const m   = otherMeanings.splice(idx,1)[0];
        distractors.push(m);
    }
    const choices = [correctChinese, ...distractors].sort(() => Math.random() - 0.5);

    // 渲染题干和选项
    let html = `<div class="card"><strong>${quizWord}</strong><br><div class="chinese-options">`;
    choices.forEach(ch => {
        html += `<label id="chinese_${ch}">` +
            `<input type="radio" name="quiz_choice" value="${ch}"> ${ch}` +
            `</label><br>`;
    });
    html += `</div>`;
    html += `<button onclick="submitAnswer()">提交</button>`;
    html += `<button onclick="iDontKnow()">我不会</button>`;
    html += `<button onclick="deleteThisQuiz()" style="margin-left:0.5em;background:#e74c3c;">删除本题</button>`;
    html += `<button id="nextQuizBtn" onclick="nextQuiz()" style="display:none;margin-top:1rem;">下一题</button>`;
    html += `</div>`;

    container.innerHTML += html;
}

/** deleteThisQuiz(): 从 wordList 删除当前 quizWord 并刷新 */
function deleteThisQuiz() {
    // 删除该单词
    wordList = wordList.filter(w => w.english !== quizWord);
    saveUserData();
    // 重新构建并刷新
    buildDataGroups();
    updateQuizOptions();
    // 回退到删除前的索引，直接出下一题
    currentIndex = quizIdx;
    nextQuiz();
}


/** submitWrongAnswer():
 * 错题模式下提交→判定 & 自动移除/录入 & 自动下一题或显示按钮
 * 修正：更新 updateScore/recordWrong 时也用 entry.correct[0] */
/* ========== wrong.js（修正版） ========== */

/** nextWrong():
 * 错题模式—“给一个英文，四个中文选项”
 * 顶部显示 第 X 题 / 共 Y 题
 */
function nextWrong() {
    const container = document.getElementById('wrongArea');
    container.innerHTML = '';

    if (currentIndex >= wrongList.length) {
        container.innerHTML = '<p>错题训练结束！</p>';
        document.getElementById('wrongCards').style.display = 'block';
        switchTab('wrong');
        return;
    }

    // 顶部题号
    const total = wrongList.length;
    const num   = currentIndex + 1;
    container.innerHTML = `<div style="margin-bottom:0.5em;">第 ${num} 题 / 共 ${total} 题</div>`;

    // 本轮错题
    const entry          = wrongList[currentIndex++];
    const correctChinese = entry.meaning;
    const questionWord   = entry.correct[0];

    // 构造干扰中文释义
    const otherMeanings = keys.filter(k => k !== correctChinese).map(k => data[k][1]);
    const distractors   = [];
    while (distractors.length < 3 && otherMeanings.length) {
        const idx = Math.floor(Math.random() * otherMeanings.length);
        distractors.push(otherMeanings.splice(idx, 1)[0]);
    }
    const choices = [correctChinese, ...distractors].sort(() => Math.random() - 0.5);

    // 渲染题干和选项
    let html = `<div class="card"><strong>${questionWord}</strong><br><div class="chinese-options">`;
    choices.forEach(ch => {
        html += `<label id="wrong_chinese_${ch}">` +
            `<input type="radio" name="wrong_choice" value="${ch}"> ${ch}` +
            `</label><br>`;
    });
    html += `</div>`;
    html += `<button onclick="submitWrongAnswer()">提交</button>`;
    html += `<button onclick="iDontKnowWrong()">我不会</button>`;
    // 新增删除本题按钮
    html += `<button onclick="deleteThisWrong()" style="margin-left:0.5em;background:#e74c3c;">删除本题</button>`;
    html += `<button id="nextWrongBtn" onclick="nextWrong()" style="display:none;margin-top:1rem;">下一题</button>`;
    html += `</div>`;

    container.innerHTML += html;
}

/** deleteThisWrong():
 * 从 wrongList 中删除当前题目并继续下一题
 */
function deleteThisWrong() {
    // 删除 currentIndex-1 对应的条目
    wrongList.splice(currentIndex - 1, 1);
    saveUserData();
    // 将索引回退，以便 nextWrong 读取正确位置
    currentIndex = Math.max(0, currentIndex - 1);
    // 直接出下一题
    nextWrong();
}


/** submitWrongAnswer():
 * 错题模式下提交→判定 & 自动移除/录入 & 自动下一题或显示按钮
 */
function submitWrongAnswer() {
    const sel = document.querySelector("input[name='wrong_choice']:checked");
    if (!sel) {
        alert('请选择一个中文释义');
        return;
    }

    // 回退到当前条目
    const entry   = wrongList[currentIndex - 1];
    const correct = entry.meaning;
    const word    = entry.correct[0];

    // 高亮中文选项
    highlightChinese(correct, sel.value, 'wrong_chinese');

    if (sel.value === correct) {
        // 答对：+1 分 & 移出错题
        updateScore([word], +1);
        wrongList.splice(currentIndex - 1, 1);
        saveUserData();
        // 自动下一题
        setTimeout(() => nextWrong(), 500);
    } else {
        // 答错：-1 分 & 录入错题
        updateScore([word], -1);
        recordWrong(correct, [word]);
        saveUserData();
        document.getElementById('nextWrongBtn').style.display = 'inline-block';
    }
}


/** iDontKnowWrong():
 * 错题模式下“我不会”→高亮正确 & 录分录错 & 显示【下一题】按钮
 */
function iDontKnowWrong() {
    const entry   = wrongList[currentIndex - 1];
    const correct = entry.meaning;
    const word    = entry.correct[0];

    highlightChinese(correct, correct, 'wrong_chinese');
    updateScore([word], -1);
    recordWrong(correct, [word]);

    document.getElementById('nextWrongBtn').style.display = 'inline-block';
}
