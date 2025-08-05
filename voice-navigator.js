class VoiceNavigator {
    constructor() {
        this.isListening = false;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.currentIndex = 0;
        this.history = [];
        this.skippedSites = new Set();
        this.preferences = JSON.parse(localStorage.getItem('voice-nav-preferences') || '{}');
        this.wakeWords = ['websim', 'web sim'];
        this.isActive = true;
        
        this.commands = {
            'next': () => this.nextSite(),
            'go next': () => this.nextSite(),
            'skip': () => this.skipCurrent(),
            'skip this': () => this.skipCurrent(),
            'back': () => this.previousSite(),
            'previous': () => this.previousSite(),
            'go back': () => this.previousSite(),
            'help': () => this.showHelp(),
            'what can i say': () => this.showHelp(),
            'block this': () => this.blockSite(),
            'dont show this': () => this.blockSite(),
            'avoid this': () => this.blockSite(),
            'use elevenlabs': () => this.enableElevenLabs(),
            'switch to elevenlabs': () => this.enableElevenLabs(),
            'start listening': () => this.startListening(),
            'websim start listening': () => this.startListening(),
            'web sim start listening': () => this.startListening(),
            'stop listening': () => this.stopListening(),
            'websim stop listening': () => this.stopListening(),
            'web sim stop listening': () => this.stopListening()
        };
        
        this.init();
    }

    async init() {
        await this.loadRandomSite();
        this.initSpeechRecognition();
        this.applyPreferences();
    }

    requestPermissions() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(() => {
                document.getElementById('permissions-prompt').classList.add('hidden');
                this.startListening();
            })
            .catch((error) => {
                console.error('Microphone access denied:', error);
                alert('Microphone access is required for voice control. Please enable it in your browser settings and refresh the page.');
            });
    }

    async loadRandomSite() {
        try {
            document.getElementById('loading').classList.remove('hidden');
            
            // Fetch trending sites from WebSim API
            const response = await fetch('/api/v1/feed/trending?limit=50');
            const data = await response.json();
            
            const sites = data.feed.data.filter(site => 
                !this.skippedSites.has(site.site.id) && 
                !this.preferences.blockedSites?.includes(site.site.id)
            );
            
            if (sites.length === 0) {
                throw new Error('No sites available');
            }

            const randomSite = sites[Math.floor(Math.random() * sites.length)];
            const siteUrl = `https://websim.com/c/${randomSite.site.id}`;
            
            document.getElementById('websim-frame').src = siteUrl;
            this.currentSite = randomSite;
            
            // Update history
            this.history.push(randomSite);
            if (this.history.length > 50) this.history.shift();
            
            document.getElementById('loading').classList.add('hidden');
            
            // Pre-analyze site
            this.analyzeSite(randomSite);
            
        } catch (error) {
            console.error('Error loading site:', error);
            this.speak('Sorry, I had trouble loading a site. Let me try again.');
            setTimeout(() => this.loadRandomSite(), 2000);
        }
    }

    async analyzeSite(site) {
        // Basic content analysis
        const content = site.site.prompt?.text || site.site.title || '';
        const isGame = /game|play|interactive|simulation/i.test(content);
        const isTutorial = /tutorial|guide|how to|learn/i.test(content);
        
        if (isGame) {
            this.speak('This appears to be a game or interactive experience.');
        } else if (isTutorial) {
            this.speak('This looks like a tutorial or guide.');
        }
    }

    initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript.toLowerCase();
                    
                    if (event.results[i].isFinal) {
                        this.processVoiceCommand(transcript);
                    }
                }
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                if (event.error === 'no-speech') {
                    // Restart listening if no speech detected
                    setTimeout(() => {
                        if (this.isActive) {
                            this.recognition.start();
                        }
                    }, 1000);
                }
            };

            this.recognition.onend = () => {
                if (this.isActive) {
                    // Restart if not explicitly stopped
                    setTimeout(() => {
                        if (this.isActive) {
                            this.recognition.start();
                        }
                    }, 1000);
                }
            };
        }
    }

    processVoiceCommand(transcript) {
        const wakeWordDetected = this.wakeWords.some(word => transcript.includes(word));
        
        if (wakeWordDetected) {
            // Remove wake words from command
            let command = transcript;
            this.wakeWords.forEach(word => {
                command = command.replace(new RegExp(word, 'gi'), '').trim();
            });
            
            if (command.length > 0) {
                this.processCommand(command);
            }
        }
    }

    processCommand(command) {
        const matchedCommand = Object.keys(this.commands).find(cmd => 
            command.includes(cmd.toLowerCase())
        );

        if (matchedCommand) {
            this.commands[matchedCommand]();
        } else {
            this.speak(`I heard: ${command}. Say "help" for voice commands.`);
        }
    }

    startListening() {
        if (!this.recognition) {
            this.speak('Speech recognition not supported in this browser.');
            return;
        }

        if (!this.isActive) {
            this.isActive = true;
            this.recognition.start();
            this.updateVoiceIndicator('active');
            this.speak('Voice control activated');
        }
    }

    stopListening() {
        if (this.recognition && this.isActive) {
            this.isActive = false;
            this.recognition.stop();
            this.updateVoiceIndicator('inactive');
            this.speak('Voice control deactivated');
        }
    }

    updateVoiceIndicator(state) {
        const indicator = document.getElementById('voice-indicator');
        
        if (state === 'listening') {
            indicator.className = 'active listening';
            indicator.textContent = 'Listening...';
        } else if (state === 'active') {
            indicator.className = 'active';
            indicator.textContent = 'Voice control ready';
        } else {
            indicator.className = '';
            indicator.textContent = 'Voice control ready';
        }

        // Auto-hide after 3 seconds
        setTimeout(() => {
            indicator.className = '';
        }, 3000);
    }

    async speak(text, useElevenLabs = false) {
        if (this.preferences.useElevenLabs && useElevenLabs !== false) {
            const voiceId = this.preferences.elevenLabsVoice || 'pNInz6obpgDQGcFmaJgB';
            const result = await websim.textToSpeech({
                text,
                voice: voiceId
            });
            new Audio(result.url).play();
        } else {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.9;
            utterance.pitch = 1;
            utterance.volume = 1;
            
            utterance.onstart = () => {
                document.getElementById('status-dot').className = 'status-dot speaking';
            };
            
            utterance.onend = () => {
                document.getElementById('status-dot').className = this.isListening ? 'status-dot listening' : 'status-dot';
            };
            
            this.synthesis.speak(utterance);
        }
    }

    nextSite() {
        this.speak('Loading next site');
        this.loadRandomSite();
    }

    previousSite() {
        if (this.history.length > 1) {
            this.history.pop(); // Remove current
            const previous = this.history[this.history.length - 1];
            document.getElementById('websim-frame').src = `https://websim.com/c/${previous.site.id}`;
            this.speak('Going to previous site');
        } else {
            this.speak('No previous sites available');
        }
    }

    skipCurrent() {
        if (this.currentSite) {
            this.skippedSites.add(this.currentSite.site.id);
            this.speak('Site skipped, loading next');
            this.loadRandomSite();
        }
    }

    blockSite() {
        if (this.currentSite) {
            const blocked = this.preferences.blockedSites || [];
            blocked.push(this.currentSite.site.id);
            this.preferences.blockedSites = [...new Set(blocked)];
            localStorage.setItem('voice-nav-preferences', JSON.stringify(this.preferences));
            
            this.speak('Site blocked. I won\'t show it again.');
            this.loadRandomSite();
        }
    }

    async enableElevenLabs() {
        if (!this.preferences.useElevenLabs) {
            this.speak('Switching to ElevenLabs voices. Say "Adam" or "Antoni" to choose a voice.');
            this.preferences.useElevenLabs = true;
            localStorage.setItem('voice-nav-preferences', JSON.stringify(this.preferences));
        }
    }

    showHelp() {
        const helpText = `
            Voice commands available:
            - "WebSim next" - Load a new random site
            - "WebSim skip" - Skip current site
            - "WebSim back" - Go to previous site
            - "WebSim block this" - Never show this site again
            - "WebSim use elevenlabs" - Switch to ElevenLabs voices
            - "WebSim stop listening" - Pause voice control
            - "WebSim start listening" - Resume voice control
        `;
        this.speak(helpText);
    }

    applyPreferences() {
        // Auto-start listening if permissions already granted
        navigator.permissions.query({ name: 'microphone' }).then(result => {
            if (result.state === 'granted') {
                document.getElementById('permissions-prompt').classList.add('hidden');
                setTimeout(() => this.startListening(), 1000);
            }
        });
    }
}

// Initialize
window.voiceNav = new VoiceNavigator();

// Handle voice commands for ElevenLabs setup
window.addEventListener('voice-command', (e) => {
    const { command } = e.detail;
    
    if (command.includes('adam')) {
        window.voiceNav.preferences.elevenLabsVoice = 'pNInz6obpgDQGcFmaJgB';
        localStorage.setItem('voice-nav-preferences', JSON.stringify(window.voiceNav.preferences));
        window.voiceNav.speak('Adam voice activated');
    } else if (command.includes('antoni')) {
        window.voiceNav.preferences.elevenLabsVoice = 'ErXwobaYiN019PkySvjV';
        localStorage.setItem('voice-nav-preferences', JSON.stringify(window.voiceNav.preferences));
        window.voiceNav.speak('Antoni voice activated');
    }
});