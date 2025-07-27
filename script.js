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
function nextQuiz() {
    const container = document.getElementById('quizArea');
    container.innerHTML = '';
    if (currentIndex >= quizOrder.length) {
        container.innerHTML = '<p>做题结束！</p>';  // end of quiz
        return;
    }
    const meaningKey = quizOrder[currentIndex++];
    currentQuestion = meaningKey;
    const words = data[meaningKey][0];    // English words for this meaning
    const meaning = data[meaningKey][1];  // Chinese meaning (same as meaningKey)
    // Determine the correct English words for this question.
    // We take up to 2 lowest-score words from the group as the ones to be answered:contentReference[oaicite:37]{index=37}
    currentCorrect = [...words].sort((a, b) => getWordScore(a) - getWordScore(b)).slice(0, 2);
    // Choose a distractor meaning (different from current) that doesn't share words
    let distractorMeaning;
    do {
        distractorMeaning = keys[Math.floor(Math.random() * keys.length)];
    } while (
        distractorMeaning === meaningKey ||
        data[distractorMeaning][0].some(w => currentCorrect.includes(w))
        );
    // Prepare Chinese meaning options (correct vs distractor):contentReference[oaicite:38]{index=38}
    const chineseOptions = [meaningKey, distractorMeaning]
        .map(m => ({ key: m, meaning: data[m][1] }))
        .sort(() => Math.random() - 0.5);
    // Prepare English options: correct words + random filler words (excluding any that share meanings with correct or distractor):contentReference[oaicite:39]{index=39}
    const distractorWords = data[distractorMeaning][0];
    const fillerWords = keys
        .flatMap(k => data[k][0])
        .filter(w => !currentCorrect.includes(w) && !distractorWords.includes(w))
        .sort(() => Math.random() - 0.5)
        .slice(0, 4 - currentCorrect.length);  // get enough fillers to total 4 options
    const allOptions = [...currentCorrect, ...fillerWords].sort(() => Math.random() - 0.5);
    // Build the quiz question card HTML
    let quizHTML = `<div class='card'><strong>请选择对应下列中文释义的英文单词</strong>`;
    // Chinese meaning radio options (two options):contentReference[oaicite:40]{index=40}
    quizHTML += `<div class="chinese-options">`;
    chineseOptions.forEach(opt => {
        quizHTML += `<label id="chinese_${opt.key}">` +
            `<input type="radio" name="chinese_choice" value="${opt.key}"> ${opt.meaning}` +
            `</label>`;
    });
    quizHTML += `</div>`;
    // English word options (checkboxes for multiple correct):contentReference[oaicite:41]{index=41}
    quizHTML += `<div class="choices">`;
    allOptions.forEach(word => {
        quizHTML += `<label><input type="checkbox" name="choice" value="${word}"> ${plainWord(word)}</label><br>`;
    });
    quizHTML += `</div>`;
    // Action buttons
    quizHTML += `<button onclick="submitAnswer()">提交</button>`;
    quizHTML += `<button onclick="iDontKnow()" style="margin-left:10px;background:#eee;">我不会</button>`;
    quizHTML += `<button id="nextQuizBtn" onclick="nextQuiz()" style="display:none;margin-top:1rem;">下一题</button>`;
    quizHTML += `</div>`;
    container.innerHTML = quizHTML;
}

// Submit the answer for the current quiz question
function submitAnswer() {
    const selectedWords = Array.from(document.querySelectorAll('input[name="choice"]:checked'))
        .map(el => el.value);
    const selectedChineseEl = document.querySelector('input[name="chinese_choice"]:checked');
    if (!selectedChineseEl || selectedWords.length !== currentCorrect.length) {
        alert("请选择两个英文单词和对应的中文释义！");  // ensure both parts selected
        return;
    }
    const selectedKey = selectedChineseEl.value;  // chosen meaning (key)
    const correctKey = currentQuestion;           // correct meaning key
    const correctWords = currentCorrect;          // array of correct English words
    const meaning = currentQuestion;              // Chinese meaning text (same as key)
    // Highlight the correct and incorrect selections
    highlightChinese(correctKey, selectedKey, 'chinese');
    highlightEnglish(correctWords, selectedWords, 'choice');
    if (selectedKey === correctKey && correctWords.every(w => selectedWords.includes(w))) {
        // Correct answer: increase score and auto-advance:contentReference[oaicite:42]{index=42}
        updateScore(correctWords, +1);
        setTimeout(nextQuiz, 1000);
    } else {
        // Wrong answer: decrease score, record wrong, show Next button:contentReference[oaicite:43]{index=43}:contentReference[oaicite:44]{index=44}
        updateScore(correctWords, -1);
        recordWrong(meaning, correctWords);
        document.getElementById('nextQuizBtn').style.display = 'inline-block';
        // Reveal Chinese meanings for all options to educate user:contentReference[oaicite:45]{index=45}
        const allOptionInputs = document.querySelectorAll('input[name="choice"]');
        allOptionInputs.forEach(input => {
            const word = input.value;
            const label = input.parentElement;
            const ch = wordMap[word];
            if (ch) {
                const span = document.createElement('span');
                span.style.marginLeft = '0.5em';
                span.style.color = '#999';
                span.textContent = `(${ch})`;
                if (!label.innerText.includes(ch)) {
                    label.appendChild(span);
                }
            }
        });
    }
}

// Start reviewing wrong-list words
function startWrongReview() {
    currentIndex = 0;
    // Hide the static wrong list display and clear any leftover question
    document.getElementById('wrongCards').style.display = 'none';
    document.getElementById('wrongArea').innerHTML = '';
    nextWrong();
}

// Display the next question from the wrong list
function nextWrong() {
    const container = document.getElementById('wrongArea');
    container.innerHTML = '';
    if (currentIndex >= wrongList.length) {
        container.innerHTML = '<p>错题训练结束！</p>';
        // Show wrongCards again (updated) after finishing
        document.getElementById('wrongCards').style.display = 'block';
        switchTab('wrong');  // refresh wrong tab display
        return;
    }
    // Get the next wrong entry (meaning and correct words)
    const q = wrongList[currentIndex++];
    const meaning = q.meaning;
    const correctWords = q.correct;
    currentQuestion = meaning;
    // If the correctWords array is larger than 2, limit to 2 for the question
    currentCorrect = [...correctWords].sort((a, b) => getWordScore(a) - getWordScore(b)).slice(0, 2);
    // Pick a distractor meaning that is different and reasonably small set
    let distractorMeaning = null;
    const availableMeanings = keys.filter(k => k !== meaning);
    // Try to find a distractor meaning with no overlapping words and with few words
    for (let i = 0; i < 50; i++) {
        const cand = availableMeanings[Math.floor(Math.random() * availableMeanings.length)];
        const candWords = data[cand][0];
        // ensure no overlap and not a huge list (to provide only one distractor word later)
        if (!candWords.some(w => correctWords.includes(w)) && candWords.length <= 5) {
            distractorMeaning = cand;
            break;
        }
    }
    if (!distractorMeaning) {
        distractorMeaning = availableMeanings[Math.floor(Math.random() * availableMeanings.length)];
    }
    // Prepare Chinese meaning options (correct vs distractor)
    const chineseOptions = [meaning, distractorMeaning]
        .map(m => ({ key: m, meaning: m }))
        .sort(() => Math.random() - 0.5);
    // Prepare English options: two correct + one distractor word + other fillers
    const distractorWord = data[distractorMeaning][0][0];  // take one word from distractor meaning
    const fillerWords = keys.flatMap(k => data[k][0])
        .filter(w => !currentCorrect.includes(w) && w !== distractorWord && !correctWords.includes(w))
        .sort(() => Math.random() - 0.5)
        .slice(0, 4 - currentCorrect.length - 1);
    const allOptions = [...currentCorrect, distractorWord, ...fillerWords].sort(() => Math.random() - 0.5);
    // Build the wrong question card
    let wrongHTML = `<div class='card'><strong>选择两个英文单词和对应的一个中文释义</strong>`;
    wrongHTML += `<div class="chinese-options">`;
    chineseOptions.forEach(opt => {
        wrongHTML += `<label id="wrong_chinese_${opt.key}">` +
            `<input type="radio" name="chinese_choice" value="${opt.key}"> ${opt.meaning}` +
            `</label>`;
    });
    wrongHTML += `</div>`;
    wrongHTML += `<div class='choices'>`;
    allOptions.forEach(word => {
        wrongHTML += `<label><input type="checkbox" name="wrong_choice" value="${word}"> ${plainWord(word)}</label><br>`;
    });
    wrongHTML += `</div>`;
    wrongHTML += `<button onclick="submitWrongAnswer()">提交</button>`;
    wrongHTML += `<button onclick="iDontKnowWrong()" style="margin-left:10px;background:#eee;">我不会</button>`;
    wrongHTML += `<button id="nextWrongBtn" onclick="nextWrong()" style="display:none;margin-top:1rem;">下一题</button>`;
    wrongHTML += `<button onclick="removeWrong(${currentIndex - 1})" style="margin-top:1rem;">删除本题</button>`;
    wrongHTML += `<button onclick="exitWrongReview()" style="margin-top:1rem;background:#ccc;">退出训练</button>`;
    wrongHTML += `</div>`;
    container.appendChild(document.createRange().createContextualFragment(wrongHTML));
}

// Submit the answer for the current wrong-list question
function submitWrongAnswer() {
    const selectedWords = Array.from(document.querySelectorAll('input[name="wrong_choice"]:checked'))
        .map(el => el.value);
    const selectedChineseEl = document.querySelector('input[name="chinese_choice"]:checked');
    if (!selectedChineseEl || selectedWords.length !== currentCorrect.length) {
        alert("请选择两个英文和一个中文！");
        return;
    }
    const chosenChinese = selectedChineseEl.value;
    const correctChinese = currentQuestion;
    const labels = document.querySelectorAll('input[name="wrong_choice"]');
    const isChineseCorrect = (chosenChinese === correctChinese);
    const isWordsCorrect = currentCorrect.every(w => selectedWords.includes(w));
    // Highlight the Chinese options
    const correctLabel = document.getElementById(`wrong_chinese_${correctChinese}`);
    const chosenLabel = document.getElementById(`wrong_chinese_${chosenChinese}`);
    if (correctLabel) correctLabel.style.background = '#c8f7c5'; // correct: green
    if (!isChineseCorrect && chosenLabel) chosenLabel.style.background = '#f8d7da'; // wrong: red
    if (isChineseCorrect && isWordsCorrect) {
        // Correct: highlight selected words in green:contentReference[oaicite:46]{index=46}:contentReference[oaicite:47]{index=47}
        selectedWords.forEach(sel => {
            const input = [...labels].find(l => l.value === sel);
            if (input) input.parentElement.style.background = '#c8f7c5';
        });
        // Remove this item from wrongList as it's answered correctly
        removeWrong(currentIndex - 1);
        // Continue to next after brief delay
        setTimeout(nextWrong, 1000);
    } else {
        // Wrong: highlight selected words in red, correct words in green
        selectedWords.forEach(sel => {
            const input = [...labels].find(l => l.value === sel);
            if (input) input.parentElement.style.background = '#f8d7da';
        });
        [...labels].forEach(input => {
            if (currentCorrect.includes(input.value)) {
                input.parentElement.style.background = '#c8f7c5';
            }
        });
        // Show Chinese meaning for all options:contentReference[oaicite:48]{index=48}:contentReference[oaicite:49]{index=49}
        [...labels].forEach(input => {
            const word = input.value;
            const label = input.parentElement;
            const ch = wordMap[word];
            if (ch) {
                const span = document.createElement('span');
                span.style.marginLeft = '0.5em';
                span.style.color = '#999';
                span.textContent = `(${ch})`;
                if (!label.innerText.includes(ch)) {
                    label.appendChild(span);
                }
            }
        });
        // Show Next button to proceed
        const nextBtn = document.getElementById('nextWrongBtn');
        if (nextBtn) nextBtn.style.display = 'inline-block';
    }
}

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
function iDontKnow() {
    const correctKey = currentQuestion;
    const correctWords = currentCorrect;
    // Highlight the correct Chinese option (we know it)
    highlightChinese(correctKey, correctKey, 'chinese');
    // Highlight correct English words (none selected by user)
    highlightEnglish(correctWords, [], 'choice');
    // Show Chinese meanings for all options
    const labels = document.querySelectorAll('input[name="choice"]');
    labels.forEach(input => {
        const word = input.value;
        const label = input.parentElement;
        const ch = wordMap[word];
        if (ch) {
            const span = document.createElement('span');
            span.style.marginLeft = '0.5em';
            span.style.color = '#999';
            span.textContent = `(${ch})`;
            if (!label.innerText.includes(ch)) {
                label.appendChild(span);
            }
        }
    });
    // Update score and record to wrong list
    updateScore(correctWords, -1);
    recordWrong(correctKey, correctWords);
    // Show Next button
    document.getElementById('nextQuizBtn').style.display = 'inline-block';
}

// "I don't know" in wrong mode
function iDontKnowWrong() {
    const correctKey = currentQuestion;
    const correctWords = currentCorrect;
    // Highlight correct Chinese
    highlightChinese(correctKey, correctKey, 'wrong_chinese');
    // Highlight correct English
    highlightEnglish(correctWords, [], 'wrong_choice');
    // Show meanings for all options
    const labels = document.querySelectorAll('input[name="wrong_choice"]');
    labels.forEach(input => {
        const word = input.value;
        const label = input.parentElement;
        const ch = wordMap[word];
        if (ch) {
            const span = document.createElement('span');
            span.style.marginLeft = '0.5em';
            span.style.color = '#999';
            span.textContent = `(${ch})`;
            if (!label.innerText.includes(ch)) {
                label.appendChild(span);
            }
        }
    });
    // (Do not remove from wrong list, user will see it again)
    const nextBtn = document.getElementById('nextWrongBtn');
    if (nextBtn) nextBtn.style.display = 'inline-block';
}

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
