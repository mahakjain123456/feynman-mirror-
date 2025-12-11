import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, ClarityUpdate } from '../types';
import { createPcmBlob, decodeAudioData, arrayBufferToBase64 } from '../services/audioUtils';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

// Function definition to allow the model to update the UI
const updateClarityFunction: FunctionDeclaration = {
  name: 'updateClarity',
  description: 'Call this function to update the user\'s clarity score based on their explanation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      score: {
        type: Type.NUMBER,
        description: 'Integer from 0 to 100 representing how clear and simple the explanation is.',
      },
      reasoning: {
        type: Type.STRING,
        description: 'Brief text explaining why the score was given (e.g., "Too much jargon" or "Great analogy").',
      },
      language: {
        type: Type.STRING,
        description: 'The detected language of the user (e.g., "English", "Hindi", "Telugu", "Spanish").',
      },
    },
    required: ['score', 'reasoning', 'language'],
  },
};

export const useLiveSession = (
  apiKey: string,
  onClarityUpdate: (update: ClarityUpdate) => void,
  onTranscription: (text: string, type: 'user' | 'model') => void
) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const isAudioOnlyRef = useRef(false);

  // Sync ref with state
  useEffect(() => {
    isAudioOnlyRef.current = isAudioOnly;
  }, [isAudioOnly]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Audio Contexts
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  
  // Stream References
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null); // To hold the active session
  const videoIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const disconnect = useCallback(async () => {
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Stop video loop
    if (videoIntervalRef.current) {
      window.clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    // Close Audio Contexts
    if (inputAudioContextRef.current) {
      await inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      // Stop all playing sources
      sourceNodesRef.current.forEach(source => {
        try { source.stop(); } catch (e) {}
      });
      sourceNodesRef.current.clear();
      await outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // We can't explicitly "close" the session object in the same way as a socket, 
    // but we can release references and set state.
    sessionRef.current = null;
    setConnectionState(ConnectionState.DISCONNECTED);
  }, []);

  const connect = useCallback(async () => {
    if (!apiKey) {
      console.error("No API Key provided");
      return;
    }

    try {
      setConnectionState(ConnectionState.CONNECTING);
      
      const ai = new GoogleGenAI({ apiKey });

      // Initialize Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextStartTimeRef.current = 0;

      // Get Media Stream (Video + Audio)
      // Note: We use the local `isAudioOnly` (which is current state) for stream constraints.
      // If we start audio only, we can't switch to video later without reconnecting.
      // If we start with video, we can "mute" it using isAudioOnlyRef check in the interval.
      const constraints = { 
        audio: {
            channelCount: 1,
            sampleRate: 16000,
        }, 
        video: !isAudioOnly ? { width: 640, height: 480 } : false 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      // Attach video to ref for preview
      if (videoRef.current && !isAudioOnly) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error("Error playing video preview", e));
      }

      // Track transcription state locally for this session
      let currentInputTranscription = "";
      let currentOutputTranscription = "";

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are "Feynman", a helpful, patient, and encouraging teaching assistant. 
          Your goal is to help the user learn a concept by explaining it to you.
          
          CORE INSTRUCTIONS:
          1. Listen to their explanation.
          2. Ignore minor stutters or anxiety. Focus on the CONCEPTUAL clarity.
          3. If they are clear, be affirmative. If they are confused or using too much jargon, ask clarifying questions.
          4. CRITICAL: You MUST call the 'updateClarity' tool FREQUENTLY (every few sentences) to provide real-time feedback.
          5. Keep spoken responses concise and conversational.
          6. If you are not 100% sure of a fact, do not correct the user. It is better to be silent than wrong.
          
          STRICT LANGUAGE MIRRORING PROTOCOL:
          - **ALWAYS speak in the EXACT same language the user is currently speaking.**
          - **Dynamic Switching:** If the user starts in English and switches to Hindi mid-sentence, **YOU MUST SWITCH TO HINDI IMMEDIATELY.**
          - If the user speaks Telugu, you speak Telugu. If they speak Spanish, you speak Spanish.
          - **No Mixing:** Do not mix English sentences into non-English responses unless it is a specific technical term widely used in that language (e.g. "Database" in Hindi context).
          - Do not translate unless asked. Just respond naturally in the detected language.
          
          VISUAL BEHAVIOR ANALYSIS: Watch the user's eyes carefully.
          The 'Reading' Detection: If the user's eyes are moving left-to-right in a scanning pattern, or if they are staring fixedly at a point off-camera for more than 10 seconds while speaking fluently, assume they are reading a script.
          The Reaction: If you detect this, INTERRUPT them playfully. Say something like: 'I see those eyes scanning! Are you reading a script? Try looking at me and explaining it from memory.' (Translate this phrase to the user's current language).
          The 'Cheat' Flag: If this happens, set the clarity_score to a maximum of 50% until they stop reading.`,
          tools: [{ functionDeclarations: [updateClarityFunction] }],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setConnectionState(ConnectionState.CONNECTED);

            // --- Audio Input Setup ---
            if (!inputAudioContextRef.current) {
                console.warn("Input Audio Context is missing in onopen. Skipping setup.");
                return;
            }

            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            audioProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (!inputAudioContextRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);

            // --- Video Input Setup ---
            // Only setup interval if we actually requested video (based on initial state)
            if (!isAudioOnly && canvasRef.current && videoRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                videoIntervalRef.current = window.setInterval(() => {
                    // Check the REF for dynamic muting of video
                    if (isAudioOnlyRef.current) return;

                    const videoEl = videoRef.current;
                    if (videoEl && ctx && videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
                        canvasRef.current!.width = videoEl.videoWidth;
                        canvasRef.current!.height = videoEl.videoHeight;
                        ctx.drawImage(videoEl, 0, 0);
                        
                        const base64Data = canvasRef.current!.toDataURL('image/jpeg', 0.5).split(',')[1];
                        sessionPromise.then(session => session.sendRealtimeInput({
                            media: { mimeType: 'image/jpeg', data: base64Data }
                        }));
                    }
                }, 1000); // 1 FPS is enough for "Mirror" context checking
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Tool Calls (Clarity Update)
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'updateClarity') {
                    const update = fc.args as unknown as ClarityUpdate;
                    onClarityUpdate(update);
                    
                    // Acknowledge the tool call
                    sessionPromise.then(session => session.sendToolResponse({
                        functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { result: "ok" } // Ack
                        }
                    }));
                }
              }
            }

            // Handle Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                const buffer = await decodeAudioData(audioData, ctx);
                
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                
                // Scheduling
                const now = ctx.currentTime;
                // Ensure we don't schedule in the past
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
                
                sourceNodesRef.current.add(source);
                source.onended = () => sourceNodesRef.current.delete(source);
            }

            // Handle Transcription
            if (msg.serverContent?.inputTranscription?.text) {
                currentInputTranscription += msg.serverContent.inputTranscription.text;
            }
            if (msg.serverContent?.outputTranscription?.text) {
                currentOutputTranscription += msg.serverContent.outputTranscription.text;
            }

            // Commit transcription on turn complete
            if (msg.serverContent?.turnComplete) {
                if (currentInputTranscription.trim()) {
                    onTranscription(currentInputTranscription, 'user');
                    currentInputTranscription = "";
                }
                if (currentOutputTranscription.trim()) {
                    onTranscription(currentOutputTranscription, 'model');
                    currentOutputTranscription = "";
                }
            }
          },
          onclose: () => {
            console.log("Session Closed");
            disconnect();
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setConnectionState(ConnectionState.ERROR);
            disconnect();
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Connection failed", error);
      setConnectionState(ConnectionState.ERROR);
      disconnect();
    }
  }, [apiKey, isAudioOnly, disconnect, onClarityUpdate, onTranscription]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const sendTextMessage = (text: string) => {
      if (sessionRef.current) {
          sessionRef.current.then((session: any) => {
              session.sendRealtimeInput({ text: text });
          });
      }
  };

  return {
    connectionState,
    connect,
    disconnect,
    videoRef,
    canvasRef,
    setIsAudioOnly,
    sendTextMessage
  };
};