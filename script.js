/**
 * Monte Carlo DCF Simulator
 * 
 * Core Logic:
 * 1. Calculate FCF0 based on historical data.
 * 2. Run Monte Carlo simulation for g (growth rate) and r (discount rate).
 * 3. Calculate theoretical share price for each iteration.
 * 4. Visualize distribution and calculate statistics.
 */

// --- Global State ---
let chartInstance = null;
let simulationResults = []; // Stores valid price results
let lastSimulationParams = {}; // Stores params for AI prompt

// --- Helper Functions ---

/**
 * Seeded Random Number Generator (Mulberry32)
 */
function mulberry32(a) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

/**
 * Triangular Distribution Random Generator
 * @param {number} min 
 * @param {number} mode 
 * @param {number} max 
 * @param {function} randomFunc - RNG function (returns 0-1)
 * @returns {number} Random value from triangular distribution
 */
function triRandom(min, mode, max, randomFunc = Math.random) {
    const u = randomFunc();
    const c = (mode - min) / (max - min);

    if (u < c) {
        return min + Math.sqrt(u * (max - min) * (mode - min));
    } else {
        return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
}

/**
 * Calculate Mean of an array
 */
function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculate Percentile (Linear Interpolation)
 * @param {number[]} sortedArr - Sorted array of numbers
 * @param {number} p - Percentile (0 to 1)
 */
function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const index = (sortedArr.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (upper >= sortedArr.length) return sortedArr[lower];
    return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

/**
 * Calculate Probability above threshold
 */
function probAbove(sortedArr, threshold) {
    if (sortedArr.length === 0) return 0;
    // Find first index where value > threshold
    // Since array is sorted, we can count from there
    const count = sortedArr.filter(v => v > threshold).length;
    return (count / sortedArr.length) * 100;
}

/**
 * Calculate percentile rank of a value within a sorted array
 * @param {number[]} sortedArr - sorted ascending
 * @param {number} value
 * @returns {number} percentile (0-100)
 */
function percentileRank(sortedArr, value) {
    if (sortedArr.length === 0 || !Number.isFinite(value)) return NaN;
    let count = 0;
    for (let i = 0; i < sortedArr.length; i++) {
        if (sortedArr[i] <= value) count++;
        else break;
    }
    return (count / sortedArr.length) * 100;
}

// --- Core Logic ---

function getInputs() {
    const unitMult = parseFloat(document.getElementById('unitSelect').value) || 1;

    const currentPrice = parseFloat(document.getElementById('currentPrice').value);
    const shares = parseFloat(document.getElementById('shares').value);
    const debt = (parseFloat(document.getElementById('debt').value) || 0) * unitMult;
    const cash = (parseFloat(document.getElementById('cash').value) || 0) * unitMult;

    // Historical FCF
    const cfoInputs = Array.from(document.querySelectorAll('.cfo-input')).map(i => parseFloat(i.value) * unitMult);
    const cfiInputs = Array.from(document.querySelectorAll('.cfi-input')).map(i => parseFloat(i.value) * unitMult);
    const fcfMethod = document.querySelector('input[name="fcfMethod"]:checked').value;

    // Future FCF Inputs
    const futureFcfInputs = Array.from(document.querySelectorAll('.future-fcf-input')).map(i => parseFloat(i.value) * unitMult);

    // Growth Rate
    const gMin = parseFloat(document.getElementById('gMin').value);
    const gMode = parseFloat(document.getElementById('gMode').value);
    const gMax = parseFloat(document.getElementById('gMax').value);

    // Discount Rate
    const rFixedCheck = document.getElementById('rFixedCheck').checked;
    const rMin = parseFloat(document.getElementById('rMin').value);
    const rMode = parseFloat(document.getElementById('rMode').value);
    const rMax = parseFloat(document.getElementById('rMax').value);
    const rFixed = parseFloat(document.getElementById('rFixed').value);

    // Mode Selection
    const calcMode = document.querySelector('input[name="calcMode"]:checked').value;

    // Settings
    const iterations = parseInt(document.getElementById('iterations').value);
    const randomSeed = document.getElementById('randomSeed').value; // String, empty if not set

    return {
        calcMode, cfoInputs, cfiInputs, fcfMethod, futureFcfInputs,
        gMin, gMode, gMax,
        rFixedCheck, rMin, rMode, rMax, rFixed,
        debt, cash, shares, currentPrice,
        iterations, randomSeed,
        unitMult // Store for reference if needed
    };
}

function calcFcf0(cfoArr, cfiArr, method) {
    const fcfArr = cfoArr.map((cfo, i) => cfo - cfiArr[i]);

    if (method === 'avg') {
        return mean(fcfArr);
    } else {
        // Weighted average: 1, 2, 3, 4, 5
        let sum = 0;
        let weightSum = 0;
        fcfArr.forEach((val, i) => {
            const w = i + 1;
            sum += val * w;
            weightSum += w;
        });
        return sum / weightSum;
    }
}

function calcModePrice(params, fcf0, netDebt) {
    const g = params.gMode;
    const r = params.rFixedCheck ? params.rFixed : params.rMode;

    if (r - g <= 0) return NaN;

    let equityValue;

    if (params.calcMode === 'future') {
        // Detailed Mode: PV of FCF1-5 + PV of TV
        let sumPv = 0;
        params.futureFcfInputs.forEach((fcf, i) => {
            sumPv += fcf / Math.pow(1 + r, i + 1);
        });

        const fcf5 = params.futureFcfInputs[params.futureFcfInputs.length - 1];
        const tv = fcf5 * (1 + g) / (r - g);
        const tvPv = tv / Math.pow(1 + r, params.futureFcfInputs.length);

        equityValue = sumPv + tvPv - netDebt;
    } else {
        // Simple Mode: FCF0 * (1+g) / (r-g)
        const fcf1 = fcf0 * (1 + g);
        const tv = fcf1 / (r - g);
        equityValue = tv - netDebt;
    }

    return equityValue / params.shares;
}

/**
 * Binary Search: Find the first index where sortedArr[index] > value
 * @param {Array<number>} sortedArr - Sorted array of numbers
 * @param {number} value - Value to search for
 * @returns {number} Index of the first element greater than value, or arr.length if not found
 */
function firstGreaterIndex(sortedArr, value) {
    let lo = 0, hi = sortedArr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedArr[mid] <= value) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

// --- Main Simulation ---

async function runSimulation() {
    const params = getInputs();
    const warningArea = document.getElementById('warningArea');
    const runBtn = document.getElementById('runMcBtn');
    const resetBtn = document.getElementById('resetBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressLabel = document.getElementById('progressLabel');

    warningArea.style.display = 'none';
    warningArea.innerHTML = '';

    // Validation (Strict for Education)
    const commonValid = [params.gMin, params.gMode, params.gMax, params.debt, params.cash, params.shares, params.currentPrice, params.iterations].every(v => !isNaN(v));
    let modeValid = true;

    if (params.calcMode === 'future') {
        modeValid = params.futureFcfInputs.every(v => !isNaN(v));
    } else {
        modeValid = params.cfoInputs.every(v => !isNaN(v)) && params.cfiInputs.every(v => !isNaN(v));
    }

    if (!commonValid || !modeValid) {
        alert("すべての数値を正しく入力してください。");
        return;
    }

    if (params.shares <= 0) {
        alert("発行株式数は 0 より大きい値を入力してください。");
        return;
    }

    if (params.iterations > 200000) {
        if (!confirm("試行回数が 200,000 を超えています。処理に時間がかかる可能性がありますが、続行しますか？")) {
            return;
        }
    }

    // Range Validation
    if (params.gMin > params.gMode || params.gMode > params.gMax) {
        alert("成長率(g)の設定が不正です。\nMin <= Mode <= Max となるように設定してください。");
        return;
    }
    if (!params.rFixedCheck && (params.rMin > params.rMode || params.rMode > params.rMax)) {
        alert("割引率(r)の設定が不正です。\nMin <= Mode <= Max となるように設定してください。");
        return;
    }

    // Calculate FCF0 (Only for Simple Mode or reference)
    let fcf0 = 0;
    if (params.calcMode === 'historical') {
        fcf0 = calcFcf0(params.cfoInputs, params.cfiInputs, params.fcfMethod);
    } else {
        // In future mode, use the last year (Year 5) as the base for TV, but we can store it as fcf0 for display consistency or handle differently
        fcf0 = params.futureFcfInputs[params.futureFcfInputs.length - 1];
    }

    const netDebt = params.debt - params.cash;

    // Warnings
    let warnings = [];
    if (fcf0 <= 0) {
        warnings.push(`<strong>重大な警告:</strong> 基準となるFCFが ${fcf0.toFixed(2)} (0以下) です。<br>DCFモデルはプラスのキャッシュフローを前提としています。結果はマイナスまたは無効になる可能性が高いです。`);
    }
    if (!params.rFixedCheck && params.gMax >= params.rMin) {
        warnings.push(`<strong>警告:</strong> 成長率の最大値 (${params.gMax}) が割引率の最小値 (${params.rMin}) 以上です。<br>これにより "r - g <= 0" となる試行が多く発生し、計算不能になる可能性があります。`);
    }

    if (warnings.length > 0) {
        warningArea.innerHTML = warnings.join('<br><br>');
        warningArea.style.display = 'block';
    }

    // UI Setup for Simulation
    runBtn.disabled = true;
    resetBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    progressBar.value = 0;
    progressLabel.textContent = "0%";

    // Initialize RNG
    let rng = Math.random;
    if (params.randomSeed) {
        // Simple hash of the seed string to integer
        let seedInt = 0;
        const str = params.randomSeed.toString();
        for (let i = 0; i < str.length; i++) {
            seedInt = ((seedInt << 5) - seedInt) + str.charCodeAt(i);
            seedInt |= 0; // Convert to 32bit integer
        }
        // Use Mulberry32 with the hashed seed
        rng = mulberry32(seedInt);
    }

    // Monte Carlo Loop (Async Chunking)
    const prices = [];
    const chunkSize = 50000; // Process 50k iterations per frame
    let processed = 0;

    // Helper to yield control
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        while (processed < params.iterations) {
            const end = Math.min(processed + chunkSize, params.iterations);

            for (let i = processed; i < end; i++) {
                const g = triRandom(params.gMin, params.gMode, params.gMax, rng);
                let r;
                if (params.rFixedCheck) {
                    r = params.rFixed;
                } else {
                    r = triRandom(params.rMin, params.rMode, params.rMax, rng);
                }

                if (r - g <= 0.0001) {
                    continue;
                }

                let equityValue;
                if (params.calcMode === 'future') {
                    // Detailed Mode
                    let sumPv = 0;
                    for (let j = 0; j < params.futureFcfInputs.length; j++) {
                        sumPv += params.futureFcfInputs[j] / Math.pow(1 + r, j + 1);
                    }
                    const fcf5 = params.futureFcfInputs[params.futureFcfInputs.length - 1];
                    const tv = fcf5 * (1 + g) / (r - g);
                    const tvPv = tv / Math.pow(1 + r, params.futureFcfInputs.length);
                    equityValue = sumPv + tvPv - netDebt;
                } else {
                    // Simple Mode
                    const fcf1 = fcf0 * (1 + g);
                    const tv = fcf1 / (r - g);
                    equityValue = tv - netDebt;
                }

                const price = equityValue / params.shares;

                if (Number.isFinite(price)) {
                    prices.push(price);
                }
            }

            processed = end;
            const pct = Math.round((processed / params.iterations) * 100);
            progressBar.value = pct;
            progressLabel.textContent = `${pct}%`;

            // Yield control to UI
            await sleep(0);
        }
    } catch (e) {
        console.error(e);
        alert("シミュレーション中にエラーが発生しました。");
    } finally {
        runBtn.disabled = false;
        resetBtn.disabled = false;
        progressContainer.classList.add('hidden');
    }

    if (prices.length === 0) {
        alert("すべてのシミュレーションが失敗しました (r <= g)。前提条件を見直してください。");
        return;
    }

    prices.sort((a, b) => a - b);
    simulationResults = prices; // Store for download

    // Statistics
    const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const medianPrice = prices[Math.floor(prices.length / 2)];
    const p05 = prices[Math.floor(prices.length * 0.05)];
    const p95 = prices[Math.floor(prices.length * 0.95)];

    // Probability > Current Price (Binary Search)
    const idxGtCurrent = firstGreaterIndex(prices, params.currentPrice);
    const prob = ((prices.length - idxGtCurrent) / prices.length) * 100;

    const modePrice = calcModePrice(params, fcf0, netDebt);

    // Percentile Rank of Mode DCF (Binary Search)
    let modePercentile = null;
    if (!isNaN(modePrice)) {
        const idxGtMode = firstGreaterIndex(prices, modePrice);
        modePercentile = (idxGtMode / prices.length) * 100;
    }

    // Percentile Rank of Current Price (Binary Search)
    // Note: idxGtCurrent is the count of items <= currentPrice (if duplicates exist, it points after them)
    // So percentile is roughly (idx / N) * 100
    const currentPercentile = (idxGtCurrent / prices.length) * 100;

    // Update UI
    if (params.calcMode === 'future') {
        const displayFcf0 = fcf0 / params.unitMult;
        document.getElementById('resFcf0').textContent = `${formatNumber(displayFcf0)} (Year 5)`;
    } else {
        const displayFcf0 = fcf0 / params.unitMult;
        document.getElementById('resFcf0').textContent = formatNumber(displayFcf0);
    }

    document.getElementById('resModePrice').textContent = isNaN(modePrice) ? "N/A" : formatNumber(modePrice);
    document.getElementById('resMeanPrice').textContent = formatNumber(meanPrice);
    document.getElementById('resMedianPrice').textContent = formatNumber(medianPrice);
    document.getElementById('resRange').textContent = `${formatNumber(p05)} - ${formatNumber(p95)}`;
    document.getElementById('resProb').textContent = `${prob.toFixed(1)}%`;

    document.getElementById('resModePct').textContent = Number.isFinite(modePercentile) ? `${modePercentile.toFixed(1)}%` : "N/A";
    document.getElementById('resCurrentPct').textContent = Number.isFinite(currentPercentile) ? `${currentPercentile.toFixed(1)}%` : "N/A";

    // Store params for AI prompt
    lastSimulationParams = {
        fcf0, params, modePrice, meanPrice, medianPrice, p05, p95, prob, netDebt,
        modePercentile, currentPercentile
    };

    // Update Chart
    updateChart(prices, modePrice, params.currentPrice);

    // Update Sensitivity Table
    updateSensitivityTable(fcf0, params);
}



// --- Helper Functions ---

function formatNumber(num) {
    if (!Number.isFinite(num)) return "-";
    return Number(num).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function updateUnitLabels() {
    const unitSelect = document.getElementById('unitSelect');
    const unitText = unitSelect.options[unitSelect.selectedIndex].text;
    const label = `(${unitText})`;

    document.querySelectorAll('.dynamic-unit').forEach(span => {
        span.textContent = label;
    });
}

function updateNetDebtDisplay() {
    const debt = parseFloat(document.getElementById('debt').value) || 0;
    const cash = parseFloat(document.getElementById('cash').value) || 0;
    const netDebt = debt - cash;
    document.getElementById('netDebtDisplay').textContent = formatNumber(netDebt);
}

function updateFcfPreview() {
    const unitSelect = document.getElementById('unitSelect');
    const unitText = unitSelect.options[unitSelect.selectedIndex].text;

    // Calculate Average of Inputs
    const cfoInputs = Array.from(document.querySelectorAll('.cfo-input')).map(i => parseFloat(i.value));
    const cfiInputs = Array.from(document.querySelectorAll('.cfi-input')).map(i => parseFloat(i.value));

    const validCfo = cfoInputs.filter(v => !isNaN(v));
    const validCfi = cfiInputs.filter(v => !isNaN(v));

    if (validCfo.length === 0 || validCfi.length === 0) {
        document.getElementById('fcfPreview').textContent = "簡易FCF（営業CF - CapEx）: (入力エラー)";
    } else {
        const avgCfo = validCfo.reduce((a, b) => a + b, 0) / validCfo.length;
        const avgCfi = validCfi.reduce((a, b) => a + b, 0) / validCfi.length;
        const avgFcf = avgCfo - avgCfi; // Note: CapEx inputs are positive in UI, subtracted here
        document.getElementById('fcfPreview').textContent = `簡易FCF（営業CF - CapEx）: ${formatNumber(avgFcf)} (${unitText})`;
    }
}

function downloadHeatmapTSV() {
    if (!lastSimulationParams || !lastSimulationParams.params) {
        alert("シミュレーションを実行してください。");
        return;
    }

    const params = lastSimulationParams.params;
    const fcf0 = lastSimulationParams.fcf0;

    const steps = 50;
    const gMin = params.gMin;
    const gMax = params.gMax;
    let rMin, rMax;
    if (params.rFixedCheck) {
        rMin = params.rFixed;
        rMax = params.rFixed;
    } else {
        rMin = params.rMin;
        rMax = params.rMax;
    }

    let tsv = "g \\ r\t";
    // Header (r values)
    for (let j = 0; j < steps; j++) {
        const r = rMin + (rMax - rMin) * (j / (steps - 1 || 1));
        tsv += `${(r * 100).toFixed(2)}%\t`;
    }
    tsv = tsv.trim() + "\n";

    // Rows
    for (let i = 0; i < steps; i++) {
        const g = gMax - (gMax - gMin) * (i / (steps - 1 || 1));
        tsv += `${(g * 100).toFixed(2)}%\t`;

        for (let j = 0; j < steps; j++) {
            const r = rMin + (rMax - rMin) * (j / (steps - 1 || 1));

            // Calc Price
            const denom = r - g;
            let price = "";
            if (denom > 0) {
                if (params.calcMode === 'future') {
                    let sumPv = 0;
                    for (let k = 0; k < params.futureFcfInputs.length; k++) {
                        sumPv += params.futureFcfInputs[k] / Math.pow(1 + r, k + 1);
                    }
                    const fcf5 = params.futureFcfInputs[params.futureFcfInputs.length - 1];
                    const tv = fcf5 * (1 + g) / (r - g);
                    const tvPv = tv / Math.pow(1 + r, params.futureFcfInputs.length);
                    const eqv = sumPv + tvPv - (params.debt - params.cash);
                    price = (eqv / params.shares).toFixed(0);
                } else {
                    const fcf1 = fcf0 * (1 + g);
                    const tv = fcf1 / denom;
                    const eqv = tv - (params.debt - params.cash);
                    price = (eqv / params.shares).toFixed(0);
                }
            }
            tsv += `${price}\t`;
        }
        tsv = tsv.trim() + "\n";
    }

    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'heatmap_data.tsv';
    a.click();
    URL.revokeObjectURL(url);
}

function saveHeatmapPNG() {
    const canvas = document.getElementById('heatmapCanvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'heatmap.png';
    link.href = canvas.toDataURL();
    link.click();
}



function downloadSummaryTSV() {
    if (simulationResults.length === 0) {
        alert("シミュレーションを実行してください。");
        return;
    }

    // Convert to TSV
    let tsvContent = "理論株価\n";
    simulationResults.forEach(row => {
        tsvContent += `${row.toFixed(0)}\n`;
    });

    const blob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "dcf_simulation_summary.tsv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadRawTSV(prices) {
    if (!prices || prices.length === 0) {
        alert("ダウンロードするデータがありません。先にシミュレーションを実行してください。");
        return;
    }
    let tsvContent = "理論株価\n" + prices.map(p => p.toFixed(0)).join("\n");
    const blob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = "dcf_simulation_raw.tsv";
    a.click();
    URL.revokeObjectURL(url);
}

function updateSensitivityTable(fcf0, params) {
    // Reverse order for g: Max -> Mode -> Min (High to Low)
    const gVals = [params.gMax, params.gMode, params.gMin];
    const rVals = !params.rFixedCheck ?
        [params.rMin, params.rMode, params.rMax] :
        [params.rFixed]; // r固定の場合は1列のみ

    // 1. Calculate all values first to find Min/Max
    let results = [];
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    gVals.forEach(g => {
        let rowData = [];
        rVals.forEach(r => {
            const denom = r - g;
            let price = null;
            if (denom > 0) {
                if (params.calcMode === 'future') {
                    // Detailed Mode Sensitivity
                    let sumPv = 0;
                    for (let j = 0; j < params.futureFcfInputs.length; j++) {
                        sumPv += params.futureFcfInputs[j] / Math.pow(1 + r, j + 1);
                    }
                    const fcf5 = params.futureFcfInputs[params.futureFcfInputs.length - 1];
                    const tv = fcf5 * (1 + g) / (r - g);
                    const tvPv = tv / Math.pow(1 + r, params.futureFcfInputs.length);
                    const eqv = sumPv + tvPv - (params.debt - params.cash);
                    price = eqv / params.shares;
                } else {
                    // Simple Mode Sensitivity
                    const fcf1 = fcf0 * (1 + g);
                    const tv = fcf1 / denom;
                    const eqv = tv - (params.debt - params.cash);
                    price = eqv / params.shares;
                }

                if (price !== null) {
                    if (price < minPrice) minPrice = price;
                    if (price > maxPrice) maxPrice = price;
                }
            }
            rowData.push(price);
        });
        results.push(rowData);
    });

    // 2. Build Table HTML
    const tbl = document.getElementById('sensitivityTable');
    tbl.innerHTML = "";

    // Header
    let header = "<tr><th>g \\ r</th>";
    rVals.forEach(r => header += `<th>${(r * 100).toFixed(1)}%</th>`);
    header += "</tr>";
    tbl.insertAdjacentHTML("beforeend", header);

    // Body
    gVals.forEach((g, i) => {
        let row = `<tr><th>${(g * 100).toFixed(1)}%</th>`;
        results[i].forEach(price => {
            let txt = "N/A";
            let bg = "#ffffff";
            let fg = "#000000";
            if (price !== null) {
                txt = formatNumber(price);
                bg = getHeatmapColor(price, minPrice, maxPrice);

                // Text color visibility
                const ratio = (price - minPrice) / (maxPrice - minPrice || 1);
                if (ratio < 0.4 || ratio > 0.6) {
                    fg = "#ffffff";
                }
            }
            row += `<td style="background-color:${bg}; color:${fg};">${txt}</td>`;
        });
        row += "</tr>";
        tbl.insertAdjacentHTML("beforeend", row);
    });

    // Call Heatmap Update
    updateFineGrainedHeatmap(fcf0, params, minPrice, maxPrice);
}

function getHeatmapColor(value, minVal, maxVal) {
    if (!Number.isFinite(value) || !Number.isFinite(minVal) || !Number.isFinite(maxVal) || maxVal === minVal) {
        return 'rgb(240, 240, 240)';
    }

    const ratio = (value - minVal) / (maxVal - minVal);
    const clamp = (n) => Math.min(1, Math.max(0, n));

    let r, g, b;

    if (ratio <= 0.5) {
        // 0.0 - 0.5: Dark Blue (#1d4ed8) -> White (#ffffff)
        const t = clamp(ratio / 0.5);
        const blue = { r: 29, g: 78, b: 216 };
        r = Math.round(blue.r + t * (255 - blue.r));
        g = Math.round(blue.g + t * (255 - blue.g));
        b = Math.round(blue.b + t * (255 - blue.b));
    } else {
        // 0.5 - 1.0: White (#ffffff) -> Dark Red (#dc2626)
        const t = clamp((ratio - 0.5) / 0.5);
        const red = { r: 220, g: 38, b: 38 };
        r = Math.round(255 + t * (red.r - 255));
        g = Math.round(255 + t * (red.g - 255));
        b = Math.round(255 + t * (red.b - 255));
    }

    return `rgb(${r}, ${g}, ${b})`;
}

function updateFineGrainedHeatmap(fcf0, params, globalMin, globalMax) {
    const container = document.getElementById('heatmapContainer');
    const canvas = document.getElementById('heatmapCanvas');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('heatmapTooltip');

    // Show container
    if (container) container.style.display = 'block';
    if (!canvas) return;

    // Dimensions
    const width = canvas.width;
    const height = canvas.height;
    const steps = 50; // Resolution (50x50 grid)

    // Ranges
    const gMin = params.gMin;
    const gMax = params.gMax;

    let rMin, rMax;
    if (params.rFixedCheck) {
        rMin = params.rFixed;
        rMax = params.rFixed;
    } else {
        rMin = params.rMin;
        rMax = params.rMax;
    }

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Helper to get price
    function calcPrice(g, r) {
        const denom = r - g;
        if (denom <= 0) return null;

        if (params.calcMode === 'future') {
            let sumPv = 0;
            for (let j = 0; j < params.futureFcfInputs.length; j++) {
                sumPv += params.futureFcfInputs[j] / Math.pow(1 + r, j + 1);
            }
            const fcf5 = params.futureFcfInputs[params.futureFcfInputs.length - 1];
            const tv = fcf5 * (1 + g) / (r - g);
            const tvPv = tv / Math.pow(1 + r, params.futureFcfInputs.length);
            const eqv = sumPv + tvPv - (params.debt - params.cash);
            return eqv / params.shares;
        } else {
            const fcf1 = fcf0 * (1 + g);
            const tv = fcf1 / denom;
            const eqv = tv - (params.debt - params.cash);
            return eqv / params.shares;
        }
    }

    // Draw Grid
    const cellW = width / steps;
    const cellH = height / steps;

    for (let i = 0; i < steps; i++) { // Y (g)
        for (let j = 0; j < steps; j++) { // X (r)
            // Interpolate g and r
            // Y goes from Top (0) to Bottom (height).
            // We want Top = gMax, Bottom = gMin.
            const g = gMax - (gMax - gMin) * (i / (steps - 1 || 1));
            const r = rMin + (rMax - rMin) * (j / (steps - 1 || 1));

            const price = calcPrice(g, r);
            ctx.fillStyle = getHeatmapColor(price, globalMin, globalMax);
            // Fill rectangle slightly larger to avoid gaps
            ctx.fillRect(j * cellW, i * cellH, cellW + 1, cellH + 1);
        }
    }

    // Tooltip Handler
    canvas.onmousemove = function (e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const steps = 50;
        const cellW = width / steps;
        const cellH = height / steps;

        const gridI = Math.floor(y / cellH);
        const gridJ = Math.floor(x / cellW);

        const safeI = Math.min(Math.max(gridI, 0), steps - 1);
        const safeJ = Math.min(Math.max(gridJ, 0), steps - 1);

        // Map Y back to g (Top=Max, Bottom=Min)
        const g = gMax - (gMax - gMin) * (safeI / (steps - 1 || 1));
        const r = rMin + (rMax - rMin) * (safeJ / (steps - 1 || 1));

        const price = calcPrice(g, r);
        const priceTxt = price !== null ? price.toFixed(0) : "N/A";

        tooltip.style.display = 'block';
        tooltip.style.left = (x + 10) + 'px';
        tooltip.style.top = (y + 10) + 'px';
        tooltip.innerHTML = `
            株価: <strong>${priceTxt}</strong><br>
            成長率(g): ${(g * 100).toFixed(2)}%<br>
            割引率(r): ${(r * 100).toFixed(2)}%
        `;
    };

    canvas.onmouseleave = function () {
        tooltip.style.display = 'none';
    };
}

// --- Charting ---

function updateChart(prices, modePrice, currentPrice) {
    const ctx = document.getElementById('histogramChart').getContext('2d');

    // Create bins
    const binCount = 30;
    const minVal = prices[0];
    const maxVal = prices[prices.length - 1];
    const range = maxVal - minVal;
    const binSize = range / binCount;

    const bins = new Array(binCount).fill(0);
    const labels = [];

    // Fill bins
    prices.forEach(p => {
        let idx = Math.floor((p - minVal) / binSize);
        if (idx >= binCount) idx = binCount - 1;
        bins[idx]++;
    });

    // Generate labels (bin centers)
    for (let i = 0; i < binCount; i++) {
        const center = minVal + (i + 0.5) * binSize;
        labels.push(center.toFixed(0));
    }

    const idxForValue = (value) => {
        if (!Number.isFinite(value) || range <= 0) return null;
        let idx = Math.floor((value - minVal) / binSize);
        if (idx < 0) idx = 0;
        if (idx >= binCount) idx = binCount - 1;
        return idx;
    };

    const currentIdx = idxForValue(currentPrice);
    const modeIdx = idxForValue(modePrice);

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '頻度',
                data: bins,
                backgroundColor: 'rgba(37, 99, 235, 0.5)',
                borderColor: 'rgba(37, 99, 235, 1)',
                borderWidth: 1,
                barPercentage: 1.0,
                categoryPercentage: 1.0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                annotation: {
                    annotations: {
                        line1: currentIdx !== null ? {
                            type: 'line',
                            xMin: currentIdx,
                            xMax: currentIdx,
                            borderColor: 'rgb(255, 99, 132)',
                            borderWidth: 2,
                            label: {
                                display: true,
                                content: '現在株価',
                                position: 'start'
                            }
                        } : undefined,
                        line2: modeIdx !== null ? {
                            type: 'line',
                            xMin: modeIdx,
                            xMax: modeIdx,
                            borderColor: 'rgb(75, 192, 192)',
                            borderWidth: 2,
                            borderDash: [6, 6],
                            label: {
                                display: true,
                                content: 'モードDCF',
                                position: 'end'
                            }
                        } : undefined
                    }
                },
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => `株価: ~${items[0].label}`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: '理論株価' },
                    ticks: { maxTicksLimit: 10 }
                },
                y: {
                    title: { display: true, text: '頻度' },
                    suggestedMax: Math.max(...bins) * 1.2 // Add 20% padding at the top
                }
            }
        }
    });
}

// --- Downloads & Prompt ---



function downloadPng() {
    const canvas = document.getElementById('histogramChart');
    if (!chartInstance) {
        alert("保存するグラフがありません。");
        return;
    }
    const link = document.createElement('a');
    link.download = 'dcf_histogram.png';
    link.href = canvas.toDataURL();
    link.click();
}

function generatePrompt() {
    if (!lastSimulationParams.params) {
        alert("先にシミュレーションを実行してください。");
        return;
    }
    const { fcf0, params, modePrice, meanPrice, medianPrice, p05, p95, prob, netDebt, modePercentile, currentPercentile } = lastSimulationParams;

    const rDesc = params.rFixedCheck
        ? `Fixed = ${(params.rFixed * 100).toFixed(2)}%`
        : `Triangular: Min=${(params.rMin * 100).toFixed(2)}%, Mode=${(params.rMode * 100).toFixed(2)}%, Max=${(params.rMax * 100).toFixed(2)}%`;

    let fcfDesc = "";
    if (params.calcMode === 'future') {
        fcfDesc = `- 将来FCF (Year 1-5): ${params.futureFcfInputs.join(", ")}\n- Terminal Value基準 (Year 5): ${fcf0.toFixed(2)}`;
    } else {
        fcfDesc = `- 基準年FCF（推計）：${fcf0.toFixed(2)}`;
    }

    const text = `
以下の前提でモンテカルロDCFシミュレーションを行いました。
前提：
- 計算モード: ${params.calcMode === 'future' ? '詳細（将来予測入力）' : '簡易（過去平均）'}
${fcfDesc}
- 永続成長率 g（三角分布）：min = ${(params.gMin * 100).toFixed(2)}%, mode = ${(params.gMode * 100).toFixed(2)}%, max = ${(params.gMax * 100).toFixed(2)}%
- 割引率 r：${rDesc}
- シミュレーション回数： ${params.iterations}
- 有利子負債： ${params.debt} / 現金等： ${params.cash} / Net Debt： ${netDebt}
- 発行株式数： ${params.shares}
- 現在株価： ${params.currentPrice}

結果（理論株価）：
- モードDCF（g=mode, r=mode）： ${isNaN(modePrice) ? "N/A" : modePrice.toFixed(0)}
- 分布の平均： ${meanPrice.toFixed(0)}
- 分布の中央値： ${medianPrice.toFixed(0)}
- 5％点～95％点： ${p05.toFixed(0)} ～ ${p95.toFixed(0)}
- 現在株価を上回る確率： ${prob.toFixed(1)}%

- モードDCFの位置（理論価格分布の中のパーセンタイル）： ${Number.isFinite(modePercentile) ? modePercentile.toFixed(1) + "%" : "N/A"}
- 現在株価の位置（理論価格分布の中のパーセンタイル）： ${Number.isFinite(currentPercentile) ? currentPercentile.toFixed(1) + "%" : "N/A"}

これらの結果を踏まえて、投資家向けにわかりやすい言葉で、
企業価値評価とリスク・不確実性について解説してください。
    `.trim();

    document.getElementById('promptOutput').value = text;
}

function copyPrompt() {
    const textarea = document.getElementById('promptOutput');
    textarea.select();
    document.execCommand('copy');
    alert("クリップボードにコピーしました！");
}

function toggleRInputs() {
    const rFixedCheck = document.getElementById('rFixedCheck');
    const rangeInputs = document.getElementById('r-range-inputs');
    const fixedInput = document.getElementById('r-fixed-input');

    if (rFixedCheck && rangeInputs && fixedInput) {
        if (rFixedCheck.checked) {
            rangeInputs.classList.add('hidden');
            fixedInput.classList.remove('hidden');
        } else {
            rangeInputs.classList.remove('hidden');
            fixedInput.classList.add('hidden');
        }
    }
}

function resetInputs(e) {
    if (!confirm("入力データを消去しますか？")) return;

    // Clear all inputs (set value to empty string)
    // Placeholders will show the hint
    document.querySelectorAll('input').forEach(input => {
        if (input.type === 'radio' || input.type === 'checkbox') {
            input.checked = input.defaultChecked;
        } else {
            input.value = "";
        }
    });

    // Reset visibility of inputs based on default checked radio
    const historicalInputs = document.getElementById('historical-inputs');
    const futureInputs = document.getElementById('future-inputs');
    historicalInputs.classList.remove('hidden');
    futureInputs.classList.add('hidden');

    // Reset Unit Select
    document.getElementById('unitSelect').value = "1000000";
    updateUnitLabels();

    // Reset Results & Chart
    document.getElementById('resModePrice').textContent = "-";
    document.getElementById('resMeanPrice').textContent = "-";
    document.getElementById('resMedianPrice').textContent = "-";
    document.getElementById('resRange').textContent = "-";
    document.getElementById('resProb').textContent = "-";
    document.getElementById('resModePct').textContent = "-";
    document.getElementById('resCurrentPct').textContent = "-";
    document.getElementById('sensitivityTable').innerHTML = "";
    document.getElementById('heatmapContainer').style.display = 'none';

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    // Reset internal state
    simulationResults = [];
    lastSimulationParams = {};

    // Update derived UI elements
    toggleRInputs();
    updateNetDebtDisplay();
    updateFcfPreview();
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    // Force numeric fields to reject non-numeric input (helps prevent IME usage)
    // Force numeric fields to reject non-numeric input (helps prevent IME usage)
    // Removed restrictive keydown/paste listeners to allow negative numbers and easier editing.
    // Validation is handled in runSimulation.

    // Input listeners for live updates
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', () => {
            updateNetDebtDisplay();
            updateFcfPreview();
        });
    });

    document.querySelectorAll('input[name="fcfMethod"]').forEach(radio => {
        radio.addEventListener('change', updateFcfPreview);
    });

    // Toggle Calculation Mode
    document.querySelectorAll('input[name="calcMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const historicalInputs = document.getElementById('historical-inputs');
            const futureInputs = document.getElementById('future-inputs');
            if (e.target.value === 'future') {
                historicalInputs.classList.add('hidden');
                futureInputs.classList.remove('hidden');
            } else {
                historicalInputs.classList.remove('hidden');
                futureInputs.classList.add('hidden');
            }
        });
    });

    // Toggle Fixed R input
    document.getElementById('rFixedCheck').addEventListener('change', toggleRInputs);

    // Buttons
    document.getElementById('runMcBtn').addEventListener('click', runSimulation);
    document.getElementById('resetBtn').addEventListener('click', resetInputs);
    document.getElementById('downloadCsvBtn').addEventListener('click', downloadSummaryTSV);
    document.getElementById('downloadRawBtn').addEventListener('click', () => downloadRawTSV(simulationResults));
    document.getElementById('downloadPngBtn').addEventListener('click', downloadPng);
    document.getElementById('generatePromptBtn').addEventListener('click', generatePrompt);
    document.getElementById('copyPromptBtn').addEventListener('click', copyPrompt);
    document.getElementById('downloadHeatmapTsvBtn').addEventListener('click', downloadHeatmapTSV);
    document.getElementById('saveHeatmapPngBtn').addEventListener('click', saveHeatmapPNG);

    // Unit Select Listener
    document.getElementById('unitSelect').addEventListener('change', () => {
        updateUnitLabels();
        updateFcfPreview();
    });

    // Initial calculations
    updateUnitLabels();
    updateNetDebtDisplay();
    updateFcfPreview();
});
