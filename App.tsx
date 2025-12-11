import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { 
  Mic, MicOff, Video, VideoOff, 
  Play, Square, HelpCircle, Download,
  History, Settings, Activity, Trash2, Code,
  PanelLeftClose, PanelLeftOpen, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLiveSession } from './hooks/useLiveSession';
import ClarityGauge from './components/ClarityGauge';
import { Lesson, ConnectionState, ClarityUpdate, ChatMessage } from './types';

// Placeholder for API key - in a real app this is strictly env var
const API_KEY = process.env.API_KEY || ''; 

const WELCOME_MESSAGE = `**Welcome to Feynman Mirror!** 🎓

I am your AI teaching assistant. My goal is to help you learn by having you explain concepts to me.

**How it works:**
1. 🎯 **Select a topic** in the sidebar.
2. ▶️ **Click 'Start Lesson'**.
3. 🗣️ **Explain the concept** out loud.

I will listen, track your clarity score, and ask questions if you get stuck. Let's begin!`;

const App: React.FC = () => {
  // State
  const [clarity, setClarity] = useState<ClarityUpdate>({ score: 0, reasoning: "Waiting to start..." });
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: WELCOME_MESSAGE }
  ]);
  const [pastLessons, setPastLessons] = useState<Lesson[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAudioOnlyMode, setIsAudioOnlyMode] = useState(false);
  const [currentTopic, setCurrentTopic] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);

  // Responsive Sidebar Init
  useEffect(() => {
    if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
    }
  }, []);

  // Load history from local storage
  useEffect(() => {
    const saved = localStorage.getItem('feynman_lessons');
    if (saved) {
      setPastLessons(JSON.parse(saved));
    }
  }, []);

  const handleClarityUpdate = (update: ClarityUpdate) => {
    setClarity(update);
  };

  const handleTranscription = (text: string, role: 'user' | 'model') => {
    setMessages(prev => [...prev, { role, text }]);
  };

  // Live Session Hook
  const { 
    connectionState, 
    connect, 
    disconnect, 
    videoRef, 
    canvasRef, 
    setIsAudioOnly,
    sendTextMessage
  } = useLiveSession(API_KEY, handleClarityUpdate, handleTranscription);

  // Sync audio mode
  useEffect(() => {
    setIsAudioOnly(isAudioOnlyMode);
  }, [isAudioOnlyMode, setIsAudioOnly]);

  const toggleSession = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      finishLesson();
    } else {
      setMessages([]); // Clear chat on start (removes welcome message if present)
      setClarity({ score: 0, reasoning: "Starting lesson..." });
      connect();
    }
  };

  const finishLesson = async () => {
    // 1. Capture state needed for saving
    const finalScore = clarity.score;
    const transcriptText = messages.map(m => `${m.role}: ${m.text}`).join('\n');
    const topicToSave = currentTopic.trim() || "Untitled Session";

    // 2. Disconnect immediately
    disconnect();
    
    // 3. Generate Summary using standard Gemini API (not Live API)
    let summaryText = "No summary available.";
    if (transcriptText.trim().length > 0 && API_KEY) {
        try {
            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                // Updated Prompt: Focus on content/topic, not behavioral performance
                contents: `Analyze the following transcript of a user explaining a concept. 
                
                Generate a summary that:
                1. Identifies the core concept the user was explaining.
                2. Summarizes the key points they successfully covered.
                3. Notes any conceptual gaps or areas where they struggled with the *content*.
                
                Do not focus on their speaking style or behavior. Focus on the knowledge demonstrated.
                
                Transcript:
                ${transcriptText}`,
            });
            summaryText = response.text || "No summary generated.";
        } catch (e) {
            console.error("Summary generation failed", e);
            summaryText = "Error generating summary.";
        }
    }

    // 4. Create and Save Lesson
    const newLesson: Lesson = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString(),
      topic: topicToSave,
      summary: summaryText,
      averageScore: finalScore
    };

    const updatedLessons = [newLesson, ...pastLessons];
    setPastLessons(updatedLessons);
    localStorage.setItem('feynman_lessons', JSON.stringify(updatedLessons));
    
    // 5. Reset UI State
    setClarity({ score: 0, reasoning: "Lesson finished." });
    setMessages([{ role: 'model', text: WELCOME_MESSAGE }]); // Restore welcome message
    setCurrentTopic(""); // Reset topic input
  };

  const deleteLesson = (id: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent details expansion
    const updated = pastLessons.filter(l => l.id !== id);
    setPastLessons(updated);
    localStorage.setItem('feynman_lessons', JSON.stringify(updated));
  };

  const handleImStuck = () => {
    sendTextMessage("I am stuck and don't know how to explain this further. Please give me a small hint without giving away the whole answer.");
    setMessages(prev => [...prev, { role: 'user', text: "🆘 I'm stuck!" }]);
  };

  const downloadHistory = () => {
    const textContent = pastLessons.map(l => 
      `Date: ${l.timestamp}\nTopic: ${l.topic}\nScore: ${l.averageScore}\nSummary: ${l.summary}\n\n`
    ).join('-------------------\n');
    
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feynman-history.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!API_KEY) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
              <div className="p-8 bg-slate-800 rounded-lg max-w-md text-center">
                  <h1 className="text-2xl font-bold mb-4 text-red-400">Missing API Key</h1>
                  <p className="mb-4 text-slate-300">
                      The environment variable <code>API_KEY</code> is not set. 
                      This application requires a valid Gemini API key to function.
                  </p>
              </div>
          </div>
      )
  }

  return (
    <div className="flex h-[100dvh] bg-slate-900 text-slate-100 font-sans selection:bg-emerald-500/30 overflow-hidden">
      
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div 
            className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
          fixed inset-y-0 left-0 z-40 bg-slate-950 border-r border-slate-800 
          transition-all duration-300 ease-in-out flex flex-col overflow-hidden shadow-2xl md:shadow-none md:static
          ${isSidebarOpen ? 'w-[85vw] translate-x-0 md:w-80' : '-translate-x-full w-[85vw] md:translate-x-0 md:w-0'}
      `}>
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <div className="flex-1">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent flex items-center gap-2">
                <Activity className="w-6 h-6 text-emerald-500" />
                Feynman Mirror
            </h1>
            <p className="text-xs text-slate-500 mt-1">Teach to learn.</p>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto flex-1 scrollbar-hide">
          {/* Settings Section */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4" /> Controls
            </h2>
            
            <div className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center gap-3">
                {isAudioOnlyMode ? <Mic className="w-5 h-5 text-emerald-400" /> : <Video className="w-5 h-5 text-emerald-400" />}
                <span className="text-sm font-medium">Audio Only</span>
              </div>
              <button 
                onClick={() => setIsAudioOnlyMode(!isAudioOnlyMode)}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${isAudioOnlyMode ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${isAudioOnlyMode ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <div className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center gap-3">
                <Code className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-medium">AI Reasoning</span>
              </div>
              <input 
                type="checkbox"
                checked={showDebug}
                onChange={(e) => setShowDebug(e.target.checked)}
                className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
              />
            </div>
            
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <label className="text-xs text-slate-500 block mb-1">Topic</label>
                <input 
                    type="text" 
                    value={currentTopic}
                    onChange={(e) => setCurrentTopic(e.target.value)}
                    placeholder="Enter topic..."
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-slate-700"
                />
            </div>
          </div>

          {/* History Section */}
          <div className="space-y-4">
             <div className="flex justify-between items-center">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <History className="w-4 h-4" /> History
                </h2>
                <button onClick={downloadHistory} className="text-slate-500 hover:text-emerald-400 transition-colors" title="Download History">
                    <Download className="w-4 h-4" />
                </button>
             </div>
             
             {pastLessons.length === 0 && (
                 <p className="text-sm text-slate-600 italic">No lessons yet.</p>
             )}

             {pastLessons.map(lesson => (
               <details key={lesson.id} className="group bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <summary className="flex justify-between items-start p-3 cursor-pointer list-none hover:bg-slate-800/50 transition-colors select-none">
                      <div className="flex-1">
                          <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-slate-200">{lesson.topic}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${lesson.averageScore >= 80 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                  {lesson.averageScore}%
                              </span>
                          </div>
                          <span className="text-xs text-slate-500 block mt-1">{lesson.timestamp}</span>
                      </div>
                      <div className="flex items-center">
                        <button 
                            onClick={(e) => deleteLesson(lesson.id, e)}
                            className="text-slate-600 hover:text-red-400 hover:bg-slate-800 p-1.5 rounded transition-colors"
                            title="Delete Lesson"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                  </summary>
                  <div className="px-3 pb-3 pt-2 text-xs text-slate-400 border-t border-slate-800/50 bg-slate-950/30">
                     <ReactMarkdown className="prose prose-invert prose-xs max-w-none">
                         {lesson.summary || "No summary available."}
                     </ReactMarkdown>
                  </div>
               </details>
             ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative min-w-0">
        {/* Toggle Sidebar Button */}
        <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="absolute top-3 left-3 z-50 p-2 bg-slate-800/90 backdrop-blur-sm rounded-lg text-slate-400 hover:text-white transition-colors border border-slate-700/50 shadow-lg"
        >
            {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
        </button>

        {/* Top Bar: Clarity Graph */}
        <div className="p-4 md:p-6 pb-2 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm z-10 shrink-0">
          <div className="max-w-4xl mx-auto pl-10 md:pl-0"> {/* Padding left to avoid toggle button overlap on mobile */}
            <ClarityGauge score={clarity.score} />
            <div className="flex flex-col items-center mt-2 px-4">
                {clarity.language && (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full mb-1 border border-emerald-500/20">
                        Detected: {clarity.language}
                    </span>
                )}
                <p className="text-center text-xs md:text-sm text-slate-300 animate-pulse truncate w-full">
                    {connectionState === ConnectionState.CONNECTED ? clarity.reasoning : "AI Status: " + connectionState}
                </p>
            </div>
          </div>
        </div>

        {/* Main Work Area */}
        <div className="flex-1 overflow-hidden p-2 md:p-6">
            <div className="max-w-7xl mx-auto h-full grid gap-4 md:gap-6 
                grid-cols-1 md:grid-cols-5 
                grid-rows-[40%_1fr] md:grid-rows-1
                landscape:grid-rows-1 landscape:grid-cols-2 md:landscape:grid-cols-5
            ">
                
                {/* Left: Input (Camera/Audio) */}
                <div className="md:col-span-3 landscape:col-span-1 md:landscape:col-span-3 flex flex-col gap-4 h-full min-h-0">
                    <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-slate-700 shadow-2xl flex items-center justify-center group">
                        {/* Video Element */}
                        <video 
                            ref={videoRef} 
                            muted 
                            playsInline 
                            className={`w-full h-full object-cover transform scale-x-[-1] ${isAudioOnlyMode ? 'hidden' : 'block'}`}
                        />
                        {/* Hidden Canvas for processing */}
                        <canvas ref={canvasRef} className="hidden" />

                        {/* Audio Only Placeholder */}
                        {isAudioOnlyMode && (
                            <div className="flex flex-col items-center justify-center text-slate-500">
                                <Mic className={`w-16 h-16 md:w-24 md:h-24 mb-4 ${connectionState === ConnectionState.CONNECTED ? 'text-emerald-500 animate-pulse' : 'text-slate-700'}`} />
                                <p className="text-sm md:text-base">Listening Mode Active</p>
                            </div>
                        )}

                        {/* Overlay Controls */}
                        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 w-full justify-center px-4">
                            <button 
                                onClick={toggleSession}
                                className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold shadow-lg transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap ${
                                    connectionState === ConnectionState.CONNECTED 
                                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                                    : 'bg-emerald-500 hover:bg-emerald-600 text-slate-900'
                                }`}
                            >
                                {connectionState === ConnectionState.CONNECTED ? (
                                    <> <Square className="w-5 h-5 fill-current" /> <span className="hidden sm:inline">Stop Lesson</span><span className="sm:hidden">Stop</span> </>
                                ) : (
                                    <> <Play className="w-5 h-5 fill-current" /> <span className="hidden sm:inline">Start Lesson</span><span className="sm:hidden">Start</span> </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right: Chat / Interaction */}
                <div className="md:col-span-2 landscape:col-span-1 md:landscape:col-span-2 flex flex-col h-full bg-slate-800/50 rounded-2xl border border-slate-800 overflow-hidden min-h-0">
                    <div className="p-3 md:p-4 border-b border-slate-800 bg-slate-900/80 shrink-0">
                        <h3 className="font-semibold text-slate-300 text-sm md:text-base">Session Transcript</h3>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 font-mono text-sm relative">
                        {messages.length === 0 && (
                            <div className="text-center text-slate-600 mt-10">
                                <p>Transcript will appear here...</p>
                                <p className="text-xs mt-2">Speak clearly. I'm listening.</p>
                            </div>
                        )}
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[90%] md:max-w-[85%] p-3 rounded-lg ${
                                    msg.role === 'user' 
                                    ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' 
                                    : 'bg-slate-700 text-slate-200'
                                }`}>
                                    <ReactMarkdown className="prose prose-invert prose-sm max-w-none break-words">
                                        {msg.text}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer Actions */}
                    <div className="p-3 md:p-4 bg-slate-900 border-t border-slate-800 space-y-3 md:space-y-4 shrink-0">
                        <button 
                            onClick={handleImStuck}
                            disabled={connectionState !== ConnectionState.CONNECTED}
                            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 text-slate-300 py-2 md:py-3 rounded-lg transition-all hover:border-yellow-500/50 hover:text-yellow-400 group text-sm md:text-base"
                        >
                            <HelpCircle className="w-5 h-5 group-hover:animate-bounce" />
                            I'm Stuck 🆘
                        </button>
                        
                        {/* Debug / Reasoning Box */}
                        {showDebug && (
                            <div className="bg-black/40 rounded-lg border border-slate-700 overflow-hidden max-h-32 overflow-y-auto">
                                <div className="bg-slate-950 px-3 py-1 border-b border-slate-800 flex justify-between items-center sticky top-0">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">AI Reasoning</span>
                                </div>
                                <pre className="p-3 text-[10px] font-mono text-emerald-400 whitespace-pre-wrap break-all">
                                    {JSON.stringify(clarity, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>

      </div>
    </div>
  );
};

export default App;