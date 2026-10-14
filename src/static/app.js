document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const pageSubtitle = document.getElementById('page-subtitle');
    const srAnnouncer = document.getElementById('sr-announcer');

    // Screens
    const idleScreen = document.getElementById('idle-screen');
    const reviewScreen = document.getElementById('review-screen');
    const progressScreen = document.getElementById('progress-screen');
    const resultScreen = document.getElementById('result-screen');

    // Idle
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const leaveMessageOnlyBtn = document.getElementById('leave-message-only-btn');

    // Review
    const reviewTitle = document.getElementById('review-title');
    const selectionSummary = document.getElementById('selection-summary');
    const fileCountEl = document.getElementById('file-count');
    const fileSizeEl = document.getElementById('file-size');
    const thumbnailGrid = document.getElementById('thumbnail-grid');
    const gridActions = document.getElementById('grid-actions');
    const addMoreBtn = document.getElementById('add-more-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const guestNameInput = document.getElementById('guest-name');
    const guestMessageInput = document.getElementById('guest-message');
    const charCountEl = document.getElementById('char-count');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadBtnText = document.getElementById('upload-btn-text');

    // Progress
    const overallProgressText = document.getElementById('overall-progress-text');
    const overallProgressPercent = document.getElementById('overall-progress-percent');
    const overallProgressBar = document.getElementById('overall-progress-bar');
    const overallProgressBarWrap = document.getElementById('overall-progressbar-wrap');
    const statsBytes = document.getElementById('stats-bytes');
    const statsSpeed = document.getElementById('stats-speed');
    const statsEta = document.getElementById('stats-eta');
    const inflightList = document.getElementById('inflight-list');

    // Results
    const successView = document.getElementById('success-view');
    const successDetails = document.getElementById('success-details');
    const messageSavedBadge = document.getElementById('message-saved-badge');
    const uploadMoreBtn = document.getElementById('upload-more-btn');

    const partialView = document.getElementById('partial-view');
    const partialDetails = document.getElementById('partial-details');
    const partialMessageBadge = document.getElementById('partial-message-badge');
    const toggleFailedBtn = document.getElementById('toggle-failed-btn');
    const failedSummaryText = document.getElementById('failed-summary-text');
    const failedFilesList = document.getElementById('failed-files-list');
    const retryFailedBtn = document.getElementById('retry-failed-btn');
    const partialUploadMoreBtn = document.getElementById('partial-upload-more-btn');

    const errorView = document.getElementById('error-view');
    const errorDetails = document.getElementById('error-details');
    const retryAllBtn = document.getElementById('retry-all-btn');
    const cancelErrorBtn = document.getElementById('cancel-error-btn');

    const confettiCanvas = document.getElementById('confetti-canvas');

    // --- State ---
    let selectedFiles = []; // Array of File objects
    let totalBytes = 0;
    let isMessageOnly = false;
    let isUploading = false;
    let messageAlreadySent = false;
    let failedFilesToRetry = [];
    const objectUrls = new Set();

    // Restore guest name if remembered
    try {
        const savedName = localStorage.getItem('wedding_guest_name') || localStorage.getItem('sb_guest_name');
        if (savedName) guestNameInput.value = savedName;
    } catch (_) {}

    // --- Helpers ---
    const announce = (msg) => {
        if (srAnnouncer) srAnnouncer.textContent = msg;
    };

    const formatBytes = (bytes, decimals = 1) => {
        if (bytes === 0) return '0 MB';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    const truncateMiddle = (str, maxLen = 24) => {
        if (!str || str.length <= maxLen) return str;
        const part = Math.floor((maxLen - 3) / 2);
        return str.substring(0, part) + '…' + str.substring(str.length - part);
    };

    const showScreen = (screen) => {
        [idleScreen, reviewScreen, progressScreen, resultScreen].forEach(s => s.classList.add('hidden'));
        screen.classList.remove('hidden');

        if (screen === idleScreen) {
            pageSubtitle.textContent = 'Share your moments from our special day';
        } else if (screen === progressScreen) {
            pageSubtitle.textContent = 'Sending your memories…';
        } else {
            pageSubtitle.textContent = 'Share your moments from our special day';
        }
    };

    // Wake Lock (D4)
    let wakeLock = null;
    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (_) {}
    };

    const releaseWakeLock = async () => {
        if (wakeLock) {
            try {
                await wakeLock.release();
            } catch (_) {}
            wakeLock = null;
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isUploading) {
            requestWakeLock();
        }
    });

    // Cleanup Blob URLs to prevent memory leaks on mobile
    const revokeAllObjectUrls = () => {
        objectUrls.forEach(url => URL.revokeObjectURL(url));
        objectUrls.clear();
    };

    // Update Submit Button Label
    const updateSubmitBtnText = () => {
        const hasMsg = guestMessageInput.value.trim().length > 0;
        if (isMessageOnly || selectedFiles.length === 0) {
            uploadBtnText.textContent = 'Send Message';
        } else {
            const count = selectedFiles.length;
            const itemWord = count === 1 ? 'item' : 'items';
            if (hasMsg && !messageAlreadySent) {
                uploadBtnText.textContent = `Upload ${count} ${itemWord} & Message`;
            } else {
                uploadBtnText.textContent = `Upload ${count} ${itemWord}`;
            }
        }
    };

    // Character Counter for Message
    guestMessageInput.addEventListener('input', () => {
        charCountEl.textContent = guestMessageInput.value.length;
        updateSubmitBtnText();
    });

    // --- Thumbnail Grid (C1) ---
    const renderThumbnailGrid = () => {
        revokeAllObjectUrls();
        thumbnailGrid.innerHTML = '';

        if (isMessageOnly) {
            thumbnailGrid.classList.add('hidden');
            gridActions.classList.add('hidden');
            selectionSummary.classList.add('hidden');
            reviewTitle.textContent = 'Leave a Message';
            return;
        }

        thumbnailGrid.classList.remove('hidden');
        gridActions.classList.remove('hidden');
        selectionSummary.classList.remove('hidden');
        reviewTitle.textContent = 'Selected Media';

        const maxThumbs = 11;
        const displayFiles = selectedFiles.slice(0, maxThumbs);
        const remainingCount = selectedFiles.length - maxThumbs;

        displayFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'thumb-item';

            if (file.type.startsWith('image/')) {
                const img = document.createElement('img');
                const url = URL.createObjectURL(file);
                objectUrls.add(url);
                img.src = url;
                img.className = 'thumb-img';
                img.alt = file.name;
                img.loading = 'lazy';
                item.appendChild(img);
            } else {
                const vid = document.createElement('div');
                vid.className = 'thumb-video';
                vid.innerHTML = `
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <span>${formatBytes(file.size, 0)}</span>
                `;
                item.appendChild(vid);
            }

            // Remove Button
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'thumb-remove';
            removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
            removeBtn.innerHTML = `<span class="thumb-remove-circle" aria-hidden="true">×</span>`;
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFile(index);
            });
            item.appendChild(removeBtn);

            thumbnailGrid.appendChild(item);
        });

        // "+N more" badge
        if (remainingCount > 0) {
            const moreTile = document.createElement('div');
            moreTile.className = 'thumb-item thumb-more';
            moreTile.textContent = `+${remainingCount}`;
            thumbnailGrid.appendChild(moreTile);
        }
    };

    const removeFile = (index) => {
        selectedFiles.splice(index, 1);
        if (selectedFiles.length === 0 && !isMessageOnly) {
            resetToIdle();
            return;
        }
        updateSelectionState();
    };

    const updateSelectionState = () => {
        totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        const count = selectedFiles.length;
        fileCountEl.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
        fileSizeEl.textContent = `(${formatBytes(totalBytes)})`;
        renderThumbnailGrid();
        updateSubmitBtnText();
    };

    // --- File Selection Handlers ---
    const handleFiles = (files) => {
        if (!files || files.length === 0) return;
        isMessageOnly = false;

        const newFiles = Array.from(files);
        // Duplicate guard: avoid duplicate additions if user selects the same file again
        const existingKeys = new Set(selectedFiles.map(f => `${f.name}_${f.size}_${f.lastModified}`));
        const filteredNewFiles = newFiles.filter(f => !existingKeys.has(`${f.name}_${f.size}_${f.lastModified}`));

        selectedFiles = [...selectedFiles, ...filteredNewFiles];
        updateSelectionState();
        showScreen(reviewScreen);
        announce(`${selectedFiles.length} files selected`);
    };

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = ''; // Reset input to allow selecting same file again if desired
    });

    addMoreBtn.addEventListener('click', () => {
        fileInput.click();
    });

    clearAllBtn.addEventListener('click', () => {
        resetToIdle();
    });

    // Keyboard support for upload-area (A4)
    uploadArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });

    // Message-Only Entry Link
    leaveMessageOnlyBtn.addEventListener('click', () => {
        isMessageOnly = true;
        selectedFiles = [];
        totalBytes = 0;
        updateSelectionState();
        showScreen(reviewScreen);
        guestMessageInput.focus();
    });

    // --- In-Flight Progress Management (B1) ---
    const activeUploadRows = new Map(); // fileIndex -> DOMElement

    const addInflightRow = (fileIndex, fileName) => {
        const item = document.createElement('div');
        item.className = 'inflight-item';
        item.id = `inflight-${fileIndex}`;
        item.innerHTML = `
            <div class="inflight-header">
                <span class="inflight-filename">${truncateMiddle(fileName, 24)}</span>
                <span class="inflight-percent" id="inflight-pct-${fileIndex}">0%</span>
            </div>
            <div class="inflight-bar-bg">
                <div class="inflight-bar-fill" id="inflight-bar-${fileIndex}"></div>
            </div>
        `;
        inflightList.appendChild(item);
        activeUploadRows.set(fileIndex, item);
    };

    const updateInflightRow = (fileIndex, percent) => {
        const pctEl = document.getElementById(`inflight-pct-${fileIndex}`);
        const barEl = document.getElementById(`inflight-bar-${fileIndex}`);
        if (pctEl) pctEl.textContent = `${percent}%`;
        if (barEl) barEl.style.width = `${percent}%`;
    };

    const removeInflightRow = (fileIndex) => {
        const el = activeUploadRows.get(fileIndex);
        if (el) {
            el.remove();
            activeUploadRows.delete(fileIndex);
        }
    };

    // Set Progress helper (overall hero bar)
    const setOverallProgress = (percent) => {
        const safe = Math.max(0, Math.min(100, Math.round(percent)));
        overallProgressBar.style.width = safe + '%';
        overallProgressPercent.textContent = safe + '%';
        overallProgressBarWrap.setAttribute('aria-valuenow', safe);
    };

    // --- Confetti Animation (B6) ---
    const runConfetti = () => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const ctx = confettiCanvas.getContext('2d');
        const width = confettiCanvas.width = window.innerWidth;
        const height = confettiCanvas.height = window.innerHeight;

        const colors = ['#8C6A5D', '#6F8466', '#E8D5CB', '#D5D6CC', '#C07D38'];
        const particles = [];
        const count = 45;

        for (let i = 0; i < count; i++) {
            particles.push({
                x: width / 2 + (Math.random() - 0.5) * 80,
                y: height * 0.35,
                vx: (Math.random() - 0.5) * 12,
                vy: (Math.random() - 0.9) * 14 - 3,
                size: Math.random() * 6 + 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10,
                opacity: 1
            });
        }

        const startTime = Date.now();
        const duration = 1400;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > duration) {
                ctx.clearRect(0, 0, width, height);
                return;
            }

            ctx.clearRect(0, 0, width, height);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.4; // gravity
                p.rotation += p.rotationSpeed;
                p.opacity = Math.max(0, 1 - (elapsed / duration));

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = p.opacity;
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                ctx.restore();
            });

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    };

    // --- Message Send API (E1) ---
    const sendMessage = async (guestName, messageText, fileCount) => {
        const payload = {
            name: guestName,
            message: messageText,
            file_count: fileCount
        };

        const res = await fetch('/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(`Message failed with status ${res.status}`);
        }
        return true;
    };

    // Single File Upload with Promise & XHR
    const uploadSingleFile = (file, guestName, onProgress) => {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('files', file);
            if (guestName) formData.append('guest_name', guestName);

            xhr.upload.addEventListener('progress', (e) => {
                const total = (e.lengthComputable && e.total > 0) ? e.total : file.size;
                const loaded = e.loaded;
                const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
                onProgress(loaded, ratio);
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    onProgress(file.size, 1);
                    resolve();
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Network error')));
            xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

            xhr.open('POST', '/upload', true);
            xhr.send(formData);
        });
    };

    // --- Upload Execution & Pool Engine (E2) ---
    const runUploadEngine = async (filesList) => {
        isUploading = true;
        document.body.classList.add('is-uploading');
        await requestWakeLock();
        showScreen(progressScreen);

        const guestName = guestNameInput.value.trim();
        const guestMsg = guestMessageInput.value.trim();

        // 1. Send Message first if present and not already sent
        let messageSuccess = messageAlreadySent;
        if (guestMsg && !messageAlreadySent) {
            try {
                await sendMessage(guestName, guestMsg, filesList.length);
                messageSuccess = true;
                messageAlreadySent = true;
            } catch (err) {
                console.warn('Could not send message:', err);
                messageSuccess = false;
            }
        }

        // If message only (no files to upload)
        if (filesList.length === 0) {
            isUploading = false;
            document.body.classList.remove('is-uploading');
            await releaseWakeLock();

            if (messageSuccess) {
                showSuccessScreen(0, 0, guestName, true);
            } else {
                showErrorScreen('We could not send your message. Please check your connection and try again.');
            }
            return;
        }

        // 2. Concurrency Pool (E2)
        // Detect slow mobile connections (2G/3G) to throttle concurrency
        let maxConcurrency = 3;
        if (navigator.connection && (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === '3g')) {
            maxConcurrency = 2;
        }

        // Process smaller files first for faster feedback
        const queue = filesList.map((file, originalIdx) => ({
            file,
            originalIdx,
            size: file.size
        })).sort((a, b) => a.size - b.size);

        const totalBatchBytes = filesList.reduce((acc, f) => acc + f.size, 0);
        const processedBytesMap = new Array(filesList.length).fill(0);
        const succeededFiles = [];
        const failedFiles = [];

        inflightList.innerHTML = '';
        activeUploadRows.clear();
        setOverallProgress(0);

        let completedFilesCount = 0;
        let uploadStartTime = Date.now();
        let speedSamples = []; // { time, bytes }

        const updateStatsDisplay = (currentUploadedBytes) => {
            const now = Date.now();
            speedSamples.push({ time: now, bytes: currentUploadedBytes });
            // Keep last 4 seconds of samples
            speedSamples = speedSamples.filter(s => now - s.time <= 4000);

            let speedText = '0 MB/s';
            let etaText = 'estimating...';

            if (speedSamples.length >= 2) {
                const oldest = speedSamples[0];
                const deltaBytes = currentUploadedBytes - oldest.bytes;
                const deltaTime = (now - oldest.time) / 1000;
                if (deltaTime > 0 && deltaBytes > 0) {
                    const bytesPerSec = deltaBytes / deltaTime;
                    speedText = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;

                    const remainingBytes = Math.max(0, totalBatchBytes - currentUploadedBytes);
                    const secondsLeft = Math.round(remainingBytes / bytesPerSec);
                    if (now - uploadStartTime > 1500) {
                        if (secondsLeft < 5) etaText = 'almost done';
                        else if (secondsLeft < 60) etaText = `about ${secondsLeft}s left`;
                        else etaText = `about ${Math.ceil(secondsLeft / 60)}m left`;
                    }
                }
            }

            statsBytes.textContent = `${formatBytes(currentUploadedBytes)} of ${formatBytes(totalBatchBytes)}`;
            statsSpeed.textContent = speedText;
            statsEta.textContent = etaText;
        };

        const updateOverallUI = () => {
            const currentTotal = processedBytesMap.reduce((a, b) => a + b, 0);
            const overallPct = totalBatchBytes > 0 ? (currentTotal / totalBatchBytes) * 100 : (completedFilesCount / filesList.length) * 100;
            setOverallProgress(overallPct);
            overallProgressText.textContent = `Uploading ${Math.min(completedFilesCount + 1, filesList.length)} of ${filesList.length}`;
            updateStatsDisplay(currentTotal);
        };

        // Worker execution
        let queueIndex = 0;
        const runWorker = async () => {
            while (queueIndex < queue.length) {
                const itemIndex = queueIndex++;
                const item = queue[itemIndex];
                const { file, originalIdx } = item;

                addInflightRow(originalIdx, file.name);

                let success = false;
                // Attempt 1
                try {
                    await uploadSingleFile(file, guestName, (loaded) => {
                        processedBytesMap[originalIdx] = Math.min(file.size, loaded);
                        const filePct = Math.round((loaded / file.size) * 100);
                        updateInflightRow(originalIdx, Math.min(100, filePct));
                        updateOverallUI();
                    });
                    success = true;
                } catch (firstErr) {
                    console.warn(`Initial upload failed for ${file.name}, auto-retrying in 2s...`, firstErr);
                    // Automatic retry after 2 seconds pause (E2)
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                        await uploadSingleFile(file, guestName, (loaded) => {
                            processedBytesMap[originalIdx] = Math.min(file.size, loaded);
                            const filePct = Math.round((loaded / file.size) * 100);
                            updateInflightRow(originalIdx, Math.min(100, filePct));
                            updateOverallUI();
                        });
                        success = true;
                    } catch (retryErr) {
                        console.error(`Retry upload failed for ${file.name}:`, retryErr);
                        success = false;
                    }
                }

                removeInflightRow(originalIdx);
                completedFilesCount++;
                processedBytesMap[originalIdx] = file.size; // Mark completed in overall calculation
                updateOverallUI();

                if (success) {
                    succeededFiles.push(file);
                } else {
                    failedFiles.push(file);
                }
            }
        };

        // Launch concurrent workers
        const workers = [];
        const concurrency = Math.min(maxConcurrency, queue.length);
        for (let w = 0; w < concurrency; w++) {
            workers.push(runWorker());
        }
        await Promise.all(workers);

        // Upload batch finished
        isUploading = false;
        document.body.classList.remove('is-uploading');
        await releaseWakeLock();

        // Count photo vs video types
        const photoCount = succeededFiles.filter(f => f.type.startsWith('image/')).length;
        const videoCount = succeededFiles.filter(f => f.type.startsWith('video/')).length;

        if (failedFiles.length === 0) {
            showSuccessScreen(photoCount, videoCount, guestName, messageSuccess);
        } else if (succeededFiles.length > 0) {
            showPartialScreen(succeededFiles.length, failedFiles, messageSuccess);
        } else {
            showErrorScreen('We could not upload your files. Please check your connection and try again.');
        }
    };

    // --- Result Screen Presentations (A3, B5, B6) ---
    const showSuccessScreen = (photoCount, videoCount, guestName, msgSaved) => {
        showScreen(resultScreen);
        [successView, partialView, errorView].forEach(v => v.classList.add('hidden'));
        successView.classList.remove('hidden');

        let detailMsg = '';
        const nameGreeting = guestName ? `, ${guestName}` : '';
        const coupleName = document.body.dataset.coupleName || 'the happy couple';

        if (photoCount === 0 && videoCount === 0) {
            detailMsg = `Thank you${nameGreeting}! Your message has been sent to ${coupleName}.`;
        } else {
            const parts = [];
            if (photoCount > 0) parts.push(`${photoCount} photo${photoCount !== 1 ? 's' : ''}`);
            if (videoCount > 0) parts.push(`${videoCount} video${videoCount !== 1 ? 's' : ''}`);
            detailMsg = `Thank you${nameGreeting}! ${parts.join(' & ')} added to our album.`;
        }
        successDetails.textContent = detailMsg;

        if (msgSaved && (photoCount > 0 || videoCount > 0)) {
            messageSavedBadge.classList.remove('hidden');
        } else {
            messageSavedBadge.classList.add('hidden');
        }

        runConfetti();
        if (navigator.vibrate) navigator.vibrate(30);
        announce(`Upload complete. ${detailMsg}`);
    };

    const showPartialScreen = (successCount, failedList, msgSaved) => {
        failedFilesToRetry = [...failedList];
        showScreen(resultScreen);
        [successView, partialView, errorView].forEach(v => v.classList.add('hidden'));
        partialView.classList.remove('hidden');

        const totalAttempted = successCount + failedList.length;
        partialDetails.textContent = `Uploaded ${successCount} of ${totalAttempted} items. ${failedList.length} could not be sent.`;
        failedSummaryText.textContent = `View ${failedList.length} failed item${failedList.length !== 1 ? 's' : ''}`;

        failedFilesList.innerHTML = '';
        failedList.forEach(file => {
            const li = document.createElement('li');
            li.textContent = file.name;
            failedFilesList.appendChild(li);
        });

        if (msgSaved) {
            partialMessageBadge.classList.remove('hidden');
        } else {
            partialMessageBadge.classList.add('hidden');
        }

        announce(`Partial upload completed. ${failedList.length} items failed.`);
    };

    const showErrorScreen = (msg) => {
        showScreen(resultScreen);
        [successView, partialView, errorView].forEach(v => v.classList.add('hidden'));
        errorView.classList.remove('hidden');
        errorDetails.textContent = msg;
        announce('Upload failed.');
    };

    // Accordion toggle for failed items
    toggleFailedBtn.addEventListener('click', () => {
        const isHidden = failedFilesList.classList.toggle('hidden');
        toggleFailedBtn.setAttribute('aria-expanded', !isHidden);
    });

    // --- Action Triggers ---
    uploadBtn.addEventListener('click', async () => {
        const name = guestNameInput.value.trim();
        if (name) {
            try { localStorage.setItem('wedding_guest_name', name); } catch (_) {}
        }
        runUploadEngine(selectedFiles);
    });

    retryFailedBtn.addEventListener('click', () => {
        if (failedFilesToRetry.length > 0) {
            const toRetry = [...failedFilesToRetry];
            failedFilesToRetry = [];
            runUploadEngine(toRetry);
        }
    });

    retryAllBtn.addEventListener('click', () => {
        runUploadEngine(selectedFiles);
    });

    const resetToIdle = () => {
        selectedFiles = [];
        totalBytes = 0;
        isMessageOnly = false;
        messageAlreadySent = false;
        failedFilesToRetry = [];
        fileInput.value = '';
        guestMessageInput.value = '';
        charCountEl.textContent = '0';
        revokeAllObjectUrls();
        showScreen(idleScreen);
    };

    uploadMoreBtn.addEventListener('click', resetToIdle);
    partialUploadMoreBtn.addEventListener('click', resetToIdle);
    cancelErrorBtn.addEventListener('click', resetToIdle);
});
