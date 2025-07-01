import React, { useState, useRef, useEffect } from 'react';
import {
  Mic, Square, Upload, Download, FileText, Stethoscope,
  ClipboardList, Activity, User, Calendar, AlertCircle,
  CheckCircle, Clock, Search, Filter, BookOpen, Target,
  Heart, Brain, Pill, Shield, TrendingUp, Users
} from 'lucide-react';

const NinisinaApp = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [results, setResults] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState(null);
  const [patientInfo, setPatientInfo] = useState({
    name: '',
    age: '',
    gender: '',
    visitType: 'follow-up'
  });
  const [activeTab, setActiveTab] = useState('record');
  const [searchTerm, setSearchTerm] = useState('');
  const [consultationHistory, setConsultationHistory] = useState([]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // API base URL pointing to your Node.js server
  const API_BASE = 'http://localhost:3001';

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      reset(); // Reset previous state before starting a new recording
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });

      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setError('Failed to access microphone. Please check permissions and refresh the page.');
      console.error('Recording error:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // *** DYNAMIC PROCESSING FUNCTION ***
  const processAudio = async () => {
    if (!audioBlob) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Step 1: Upload the audio file to the server
      setProcessingStatus('Uploading audio...');
      const formData = new FormData();
      formData.append('audio', audioBlob, `consultation-${Date.now()}.webm`);

      const uploadResponse = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errData = await uploadResponse.json();
        throw new Error(`Upload failed: ${errData.error || uploadResponse.statusText}`);
      }
      const uploadData = await uploadResponse.json();
      const { filename } = uploadData;

      // Step 2: Transcribe the uploaded audio
      setProcessingStatus('Transcribing consultation...');
      const transcribeResponse = await fetch(`${API_BASE}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });

      if (!transcribeResponse.ok) {
        const errData = await transcribeResponse.json();
        throw new Error(`Transcription failed: ${errData.error || transcribeResponse.statusText}`);
      }
      const transcribeData = await transcribeResponse.json();
      const { transcript } = transcribeData;

      // Step 3: Analyze the transcript
      setProcessingStatus('Analyzing clinical data...');
      const analyzeResponse = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, patientInfo }),
      });

      if (!analyzeResponse.ok) {
        const errData = await analyzeResponse.json();
        throw new Error(`Analysis failed: ${errData.error || analyzeResponse.statusText}`);
      }
      const analysisData = await analyzeResponse.json();
      
      setResults(analysisData);
      setActiveTab('analysis'); // Switch to analysis tab on success

      // Add to consultation history
      const newConsultation = {
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        patientName: patientInfo.name || 'Unknown Patient',
        chiefComplaint: analysisData.clinicalSummary.chiefComplaint,
        duration: formatTime(recordingTime),
        priority: analysisData.medicalInsights.redFlags.some(flag => flag.status === 'Critical') ? 'High' : 'Normal'
      };

      setConsultationHistory(prev => [newConsultation, ...prev]);

    } catch (err) {
      setError(`An error occurred: ${err.message}. Please check the console and ensure the backend server is running.`);
      console.error('Processing error:', err);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const downloadResults = () => {
    if (!results) return;
    
    const content = `
MEDICAL CONSULTATION ANALYSIS - NINISINA V1
==========================================

PATIENT INFORMATION:
Name: ${patientInfo.name || 'N/A'}
Age: ${patientInfo.age || 'N/A'}
Gender: ${patientInfo.gender || 'N/A'}
Visit Type: ${patientInfo.visitType}
Date: ${new Date().toLocaleDateString()}
Duration: ${formatTime(recordingTime)}

CLINICAL SUMMARY:
================

Chief Complaint:
${results.clinicalSummary.chiefComplaint}

History of Present Illness:
${results.clinicalSummary.historyOfPresentIllness}

Assessment:
${results.clinicalSummary.assessment}

Plan:
${results.clinicalSummary.plan}

DIFFERENTIAL DIAGNOSIS:
======================
${results.medicalInsights.differentialDiagnosis.map(dx =>
  `• ${dx.condition} (${dx.probability}) - ${dx.reasoning} [ICD-10: ${dx.icd10 || 'N/A'}]`
).join('\n')}

RED FLAGS ASSESSMENT:
====================
${results.medicalInsights.redFlags.map(flag =>
  `• ${flag.flag}: ${flag.status} - ${flag.action}`
).join('\n')}

RECOMMENDATIONS:
===============
${results.medicalInsights.recommendations.map(rec => 
  `${rec.category}:\n${rec.items.map(item => `  - ${item}`).join('\n')}`
).join('\n\n')}

FOLLOW-UP REMINDERS:
===================
${results.followUpReminders.map(reminder =>
  `• ${reminder.message} (Due: ${new Date(reminder.dueDate).toLocaleDateString()})`
).join('\n')}

FULL TRANSCRIPT:
===============
${results.transcript}

Generated by Ninisina V1 Medical Assistant
Report ID: ${results.analysisMetadata.processedAt}
    `;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consultation-${patientInfo.name || 'patient'}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setAudioBlob(null);
    setResults(null);
    setRecordingTime(0);
    setError(null);
    setProcessingStatus('');
    audioChunksRef.current = [];
  };

  const TabButton = ({ id, label, icon: Icon, count }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
        activeTab === id
          ? 'bg-blue-500 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {count !== undefined && (
        <span className="bg-blue-600 px-2 py-1 rounded-full text-xs text-white">
          {count}
        </span>
      )}
    </button>
  );

  const getSeverityColor = (probability) => {
    if (!probability) return 'text-gray-600 bg-gray-50';
    const p = probability.toLowerCase();
    if (p.includes('high') || p.includes('85%') || p.includes('90%')) return 'text-red-600 bg-red-50';
    if (p.includes('moderate') || p.includes('30%') || p.includes('50%')) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };
  
  // (The rest of the JSX remains the same as your original, but I'll include it for completeness)
  // ... Paste the entire return() block from your original code here ...
  // ... I will make one small adjustment to the processing indicator ...
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-8xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Stethoscope className="w-10 h-10 text-blue-600 mr-3" />
            <h1 className="text-4xl font-bold text-gray-800">Ninisina V1</h1>
            <div className="ml-4 bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
              Medical AI Assistant
            </div>
          </div>
          <p className="text-gray-600 text-lg">Advanced Medical Consultation Analysis Platform</p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          <TabButton id="record" label="Record Consultation" icon={Mic} />
          <TabButton id="analysis" label="Clinical Analysis" icon={Brain} />
          <TabButton id="history" label="Consultation History" icon={Clock} count={consultationHistory.length} />
        </div>

        {activeTab === 'record' && (
          <div className="space-y-6">
            {/* Patient Information */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
                <User className="w-6 h-6 mr-2" />
                Patient Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <input
                  type="text"
                  placeholder="Patient Name"
                  value={patientInfo.name}
                  onChange={(e) => setPatientInfo({...patientInfo, name: e.target.value})}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="number"
                  placeholder="Age"
                  value={patientInfo.age}
                  onChange={(e) => setPatientInfo({...patientInfo, age: e.target.value})}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <select
                  value={patientInfo.gender}
                  onChange={(e) => setPatientInfo({...patientInfo, gender: e.target.value})}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                <select
                  value={patientInfo.visitType}
                  onChange={(e) => setPatientInfo({...patientInfo, visitType: e.target.value})}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="new-patient">New Patient</option>
                  <option value="follow-up">Follow-up</option>
                  <option value="urgent">Urgent Care</option>
                  <option value="routine">Routine Check-up</option>
                </select>
              </div>
            </div>

            {/* Recording Section */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
                <Mic className="w-6 h-6 mr-2" />
                Audio Recording
              </h2>
              
              <div className="flex flex-col items-center space-y-4">
                <div className="flex items-center space-x-4">
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      disabled={isProcessing}
                      className="bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white px-8 py-4 rounded-lg font-semibold flex items-center space-x-2 transition-colors text-lg"
                    >
                      <Mic className="w-6 h-6" />
                      <span>Start Recording</span>
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="bg-gray-600 hover:bg-gray-700 text-white px-8 py-4 rounded-lg font-semibold flex items-center space-x-2 transition-colors text-lg"
                    >
                      <Square className="w-6 h-6" />
                      <span>Stop Recording</span>
                    </button>
                  )}
                  
                  {audioBlob && !isRecording && (
                    <button
                      onClick={processAudio}
                      disabled={isProcessing}
                      className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-8 py-4 rounded-lg font-semibold flex items-center space-x-2 transition-colors text-lg"
                    >
                      <Upload className="w-6 h-6" />
                      <span>{isProcessing ? 'Analyzing...' : 'Analyze Consultation'}</span>
                    </button>
                  )}
                  
                  {(audioBlob || results) && (
                    <button
                      onClick={reset}
                      className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-4 rounded-lg font-semibold transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
                
                {isRecording && (
                  <div className="flex items-center space-x-3">
                    <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-2xl font-mono font-bold">{formatTime(recordingTime)}</span>
                    <span className="text-gray-600">Recording in progress...</span>
                  </div>
                )}
                
                {audioBlob && !isRecording && !results && !isProcessing && (
                  <div className="text-green-600 font-semibold text-lg flex items-center">
                    <CheckCircle className="w-5 h-5 mr-2" />
                    Recording completed ({formatTime(recordingTime)}). Ready to analyze.
                  </div>
                )}
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <p className="text-red-700 font-medium">{error}</p>
                </div>
              </div>
            )}

            {/* Processing Indicator */}
            {isProcessing && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-center justify-center space-x-3">
                  <Activity className="w-8 h-8 text-blue-600 animate-spin" />
                  <div className="text-center">
                    <p className="text-blue-800 font-semibold text-lg">Processing Medical Consultation</p>
                    <p className="text-blue-600">{processingStatus || 'Please wait...'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* The rest of the component's JSX is identical to your original code */}
        {/* It will now be populated by real data from the 'results' state */}
        {activeTab === 'analysis' && results && (
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="flex justify-center space-x-4">
              <button
                onClick={downloadResults}
                className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-colors"
              >
                <Download className="w-5 h-5" />
                <span>Download Full Report</span>
              </button>
            </div>

            {/* Clinical Summary Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                  <Target className="w-5 h-5 mr-2 text-red-500" />
                  Chief Complaint
                </h3>
                <p className="text-gray-700 bg-red-50 rounded-lg p-4">{results.clinicalSummary.chiefComplaint}</p>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                  <Heart className="w-5 h-5 mr-2 text-blue-500" />
                  Assessment
                </h3>
                <p className="text-gray-700 bg-blue-50 rounded-lg p-4">{results.clinicalSummary.assessment}</p>
              </div>
            </div>

            {/* Differential Diagnosis */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <Brain className="w-5 h-5 mr-2" />
                Differential Diagnosis
              </h3>
              <div className="space-y-3">
                {results.medicalInsights.differentialDiagnosis.map((dx, index) => (
                  <div key={index} className={`p-4 rounded-lg border-l-4 ${getSeverityColor(dx.probability)} border-l-current`}>
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold">{dx.condition}</h4>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">{dx.probability}</span>
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded">{dx.icd10}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600">{dx.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Red Flags Assessment */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <Shield className="w-5 h-5 mr-2 text-orange-500" />
                Red Flags Assessment
              </h3>
              <div className="space-y-3">
                {results.medicalInsights.redFlags.map((flag, index) => (
                  <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                    <AlertCircle className={`w-5 h-5 mt-1 ${
                      flag.status === 'Critical' ? 'text-red-500' : 
                      flag.status === 'Monitor' ? 'text-yellow-500' : 'text-green-500'
                    }`} />
                    <div className="flex-1">
                      <p className="font-medium">{flag.flag}</p>
                      <p className="text-sm text-gray-600">{flag.action}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      flag.status === 'Critical' ? 'bg-red-100 text-red-800' :
                      flag.status === 'Monitor' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {flag.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <ClipboardList className="w-5 h-5 mr-2" />
                Clinical Recommendations
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {results.medicalInsights.recommendations.map((rec, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center">
                      {rec.category === 'Immediate' && <AlertCircle className="w-4 h-4 mr-1 text-red-500" />}
                      {rec.category === 'Follow-up' && <Calendar className="w-4 h-4 mr-1 text-blue-500" />}
                      {rec.category === 'Lifestyle' && <Heart className="w-4 h-4 mr-1 text-green-500" />}
                      {rec.category}
                    </h4>
                    <ul className="space-y-1">
                      {rec.items.map((item, idx) => (
                        <li key={idx} className="text-sm text-gray-600 flex items-start">
                          <CheckCircle className="w-3 h-3 mr-2 mt-1 text-green-500 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Follow-up Reminders */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <Clock className="w-5 h-5 mr-2 text-purple-500" />
                Follow-up Reminders
              </h3>
              <div className="space-y-3">
                {results.followUpReminders.map((reminder, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${
                        reminder.type === 'urgent' ? 'bg-red-500' :
                        reminder.type === 'monitoring' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}></div>
                      <span className="font-medium flex-1">{reminder.message}</span>
                    </div>
                    <p className="text-sm text-gray-600 whitespace-nowrap">Due: {new Date(reminder.dueDate).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Full Transcript */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <FileText className="w-5 h-5 mr-2" />
                Full Consultation Transcript
              </h3>
              <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{results.transcript}</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Placeholder screens for other tabs */}
        {/* ... (These sections remain the same) ... */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-800 flex items-center">
                <Clock className="w-6 h-6 mr-2" />
                Consultation History
              </h2>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search consultations..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <Filter className="w-5 h-5 text-gray-400" />
              </div>
            </div>
            
            {consultationHistory.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">No consultations recorded yet</p>
                <p className="text-gray-400">Start by recording your first consultation</p>
              </div>
            ) : (
              <div className="space-y-3">
                {consultationHistory
                  .filter(consultation => 
                    consultation.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    consultation.chiefComplaint.toLowerCase().includes(searchTerm.toLowerCase())
                  )
                  .map((consultation) => (
                    <div key={consultation.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="font-semibold text-gray-800">{consultation.patientName}</h3>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              consultation.priority === 'High' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {consultation.priority} Priority
                            </span>
                          </div>
                          <p className="text-gray-600 mb-2">{consultation.chiefComplaint}</p>
                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <span className="flex items-center">
                              <Calendar className="w-4 h-4 mr-1" />
                              {consultation.date}
                            </span>
                            <span className="flex items-center">
                              <Clock className="w-4 h-4 mr-1" />
                              {consultation.duration}
                            </span>
                          </div>
                        </div>
                        <button className="text-blue-500 hover:text-blue-700 font-medium">
                          View Details
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        
        {/* All other tabs remain unchanged... */}
        {!results && activeTab === 'analysis' && (
           <div className="bg-white rounded-xl shadow-lg p-12 text-center">
             <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
             <p className="text-gray-500 text-lg mb-2">No consultation data available</p>
             <p className="text-gray-400">Record and analyze a consultation to view detailed medical insights</p>
             <button
               onClick={() => setActiveTab('record')}
               className="mt-4 bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
             >
               Start Recording
             </button>
           </div>
         )}
      </div>
    </div>
  );
};

export default NinisinaApp;