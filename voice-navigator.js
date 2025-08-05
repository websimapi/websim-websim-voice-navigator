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
        this.isActive = false; // Start inactive
        this.permissionGranted = false;
        this.wakeWordDetected = false;
        
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
            'web sim stop listening': () => this.stopListening(),
            'fullscreen': () => this.toggleFullscreen(),
            'full screen': () => this.toggleFullscreen()
        };
        
        this.init();
    }

    async init() {
        this.loadRandomSite();
        this.initSpeechRecognition();
        
        // Check if permission was already granted - handle both supported and unsupported browsers
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            if (result.state === 'granted') {
                this.permissionGranted = true;
                document.getElementById('permissions-prompt').classList.add('hidden');
                this.startListening();
            } else if (result.state === 'prompt') {
                // Permission needs to be requested
                console.log('Microphone permission needs to be requested');
            }
        } catch (error) {
            // Fallback for browsers without permissions API (Safari, older browsers)
            console.log('Permissions API not supported, will request directly');
            // Don't auto-request, let user click button
        }

        // Enter fullscreen mode
        this.enterFullscreen();
    }

    enterFullscreen() {
        const element = document.documentElement;
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        }
    }

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    async requestPermissions() {
        try {
            // Modern approach with proper error handling
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                } 
            });
            
            // Immediately stop the stream - we just wanted permission
            stream.getTracks().forEach(track => track.stop());
            
            this.permissionGranted = true;
            document.getElementById('permissions-prompt').classList.add('hidden');
            this.startListening();
            
        } catch (error) {
            console.error('Microphone access denied:', error);
            this.updateVoiceIndicator('error');
            
            // More specific error messages
            if (error.name === 'NotAllowedError') {
                alert('Microphone access was denied. Please enable microphone permissions in your browser settings and refresh the page.');
            } else if (error.name === 'NotFoundError') {
                alert('No microphone found. Please check that a microphone is connected and enabled.');
            } else {
                alert(`Error accessing microphone: ${error.message}. Please check your browser settings.`);
            }
        }
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
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.error('Speech recognition not supported');
            this.updateVoiceIndicator('error');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript.toLowerCase();
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Check for wake words in interim results for responsiveness
            const fullTranscript = finalTranscript || interimTranscript;
            if (this.containsWakeWord(fullTranscript)) {
                this.wakeWordDetected = true;
                this.processVoiceCommand(fullTranscript);
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.updateVoiceIndicator('error');
            
            if (event.error === 'no-speech') {
                // Continue listening
                this.restartRecognition();
            } else if (event.error === 'network') {
                this.speak('Network error with voice recognition. Please check your connection.');
            } else if (event.error === 'not-allowed') {
                this.speak('Microphone permission denied. Please check your browser settings.');
            }
        };

        this.recognition.onend = () => {
            if (this.isActive) {
                this.restartRecognition();
            }
        };
    }

    restartRecognition() {
        if (this.isActive && this.recognition) {
            setTimeout(() => {
                try {
                    this.recognition.start();
                } catch (error) {
                    console.log('Restarting recognition...');
                    setTimeout(() => this.restartRecognition(), 100);
                }
            }, 100);
        }
    }

    containsWakeWord(text) {
        return this.wakeWords.some(word => text.includes(word));
    }

    processVoiceCommand(transcript) {
        console.log('Processing voice command:', transcript);
        
        // Remove wake words
        let command = transcript;
        this.wakeWords.forEach(word => {
            command = command.replace(new RegExp(word, 'gi'), '').trim();
        });

        // Clean up command
        command = command.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');

        if (command.length > 0) {
            this.processCommand(command);
        }
    }

    processCommand(command) {
        console.log('Processing command:', command);
        
        const matchedCommand = Object.keys(this.commands).find(cmd => 
            command.includes(cmd.toLowerCase())
        );

        if (matchedCommand) {
            this.commands[matchedCommand]();
        } else {
            this.speak(`I heard: ${command}. Say "websim help" for voice commands.`);
        }
    }

    startListening() {
        if (!this.recognition) {
            this.speak('Speech recognition not supported in this browser.');
            return;
        }

        if (!this.permissionGranted) {
            // Try to request permission directly if not already granted
            this.requestPermissions();
            return;
        }

        if (!this.isActive) {
            this.isActive = true;
            this.updateVoiceIndicator('listening');
            this.speak('Voice control activated');
            try {
                this.recognition.start();
            } catch (error) {
                console.error('Error starting recognition:', error);
                this.recognition.stop();
                setTimeout(() => {
                    if (this.isActive) this.recognition.start();
                }, 100);
            }
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
        const statusDot = document.getElementById('status-dot');
        
        if (state === 'listening') {
            indicator.className = 'active listening';
            indicator.textContent = 'Listening for "websim..."';
            statusDot.className = 'status-dot listening';
        } else if (state === 'active') {
            indicator.className = 'active';
            indicator.textContent = 'Voice control ready';
            statusDot.className = 'status-dot';
        } else if (state === 'error') {
            indicator.className = 'active error';
            indicator.textContent = 'Voice error - check permissions';
            statusDot.className = 'status-dot error';
        } else {
            indicator.className = '';
            indicator.textContent = 'Voice control ready';
            statusDot.className = 'status-dot';
        }

        // Keep indicator visible when listening
        if (state === 'listening') {
            indicator.style.opacity = '1';
        }
    }

    async speak(text, useElevenLabs = null) {
        if (this.preferences.useElevenLabs && useElevenLabs !== false) {
            try {
                const voiceId = this.preferences.elevenLabsVoice || 'pNInz6obpgDQGcFmaJgB';
                const result = await websim.textToSpeech({
                    text,
                    voice: voiceId
                });
                new Audio(result.url).play();
            } catch (error) {
                console.error('ElevenLabs error, falling back to browser TTS:', error);
                this.useBrowserTTS(text);
            }
        } else {
            this.useBrowserTTS(text);
        }
    }

    useBrowserTTS(text) {
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
        
        utterance.onerror = (error) => {
            console.error('TTS error:', error);
            document.getElementById('status-dot').className = 'status-dot';
        };
        
        this.synthesis.speak(utterance);
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
}

// Initialize
window.voiceNav = new VoiceNavigator();

// Handle voice commands for ElevenLabs setup
const originalProcessCommand = VoiceNavigator.prototype.processCommand;
VoiceNavigator.prototype.processCommand = function(command) {
    if (command.includes('adam')) {
        this.preferences.elevenLabsVoice = 'pNInz6obpgDQGcFmaJgB';
        localStorage.setItem('voice-nav-preferences', JSON.stringify(this.preferences));
        this.speak('Adam voice activated');
    } else if (command.includes('antoni')) {
        this.preferences.elevenLabsVoice = 'ErXwobaYiN019PkySvjV';
        localStorage.setItem('voice-nav-preferences', JSON.stringify(this.preferences));
        this.speak('Antoni voice activated');
    } else {
        originalProcessCommand.call(this, command);
    }
};