import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { Mic, Square, Upload, Download, Pill, AlertCircle, CheckCircle, Activity, User, Calendar, Stethoscope } from 'lucide-react';

const EPrescription = ({ patientInfo }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [prescription, setPrescription] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  const API_BASE = 'https://ninisina-test.onrender.com';

  // Generate random patient ID
  const generatePatientId = () => {
    const prefix = 'PAT';
    const randomNum = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
    return `${prefix}${randomNum}`;
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      setAudioBlob(null);
      setPrescription(null);
      setRecordingTime(0);
      setError(null);
      setProcessingStatus('');
      audioChunksRef.current = [];

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

  const processPrescriptionAudio = async () => {
    if (!audioBlob) return;

    setIsProcessing(true);
    setError(null);

    try {
      setProcessingStatus('Uploading audio...');
      const formData = new FormData();
      formData.append('audio', audioBlob, `prescription-${Date.now()}.webm`);

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

      setProcessingStatus('Transcribing prescription...');
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

      setProcessingStatus('Generating prescription...');
      const prescriptionResponse = await fetch(`${API_BASE}/generate-prescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, patientInfo }),
      });

      if (!prescriptionResponse.ok) {
        const errData = await prescriptionResponse.json();
        throw new Error(`Prescription generation failed: ${errData.error || prescriptionResponse.statusText}`);
      }
      const prescriptionData = await prescriptionResponse.json();
      setPrescription(prescriptionData);
    } catch (err) {
      setError(`An error occurred: ${err.message}. Please check the console and ensure the backend server is running.`);
      console.error('Processing error:', err);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const downloadPrescription = () => {
    if (!prescription) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let currentY = margin;

    // Helper function to check if we need a new page
    const checkPageBreak = (requiredHeight) => {
      if (currentY + requiredHeight > pageHeight - margin) {
        doc.addPage();
        currentY = margin;
        return true;
      }
      return false;
    };

    // Header Section
    doc.setFillColor(41, 128, 185);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text("MEDICAL PRESCRIPTION", margin, 22);
    
    doc.setFontSize(12);
    doc.text("Electronic Health Record System", margin, 30);
    
    currentY = 45;

    // Prescription Info Bar
    const prescriptionId = prescription.prescriptionId || `RX${Date.now()}`;
    const currentDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    doc.setTextColor(41, 128, 185);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Prescription ID: ${prescriptionId}`, margin, currentY);
    doc.text(`Date: ${currentDate}`, pageWidth - margin - 80, currentY);
    
    currentY += 15;

    // Patient Information Section
    checkPageBreak(45);
    
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(1);
    doc.rect(margin, currentY, contentWidth, 40);
    
    // Patient header
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, currentY, contentWidth, 12, 'F');
    
    doc.setTextColor(41, 128, 185);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PATIENT INFORMATION", margin + 5, currentY + 8);
    
    // Patient details
    doc.setTextColor(33, 37, 41);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    
    const patientId = patientInfo?.id || generatePatientId();
    const patientData = [
      { label: "Name:", value: patientInfo?.name || 'Not provided' },
      { label: "Age:", value: patientInfo?.age || 'Not provided' },
      { label: "Gender:", value: patientInfo?.gender || 'Not provided' },
      { label: "Patient ID:", value: patientId }
    ];
    
    let detailY = currentY + 20;
    patientData.forEach((item, index) => {
      const xPos = index % 2 === 0 ? margin + 10 : margin + (contentWidth / 2);
      if (index === 2) detailY += 8;
      
      doc.setFont("helvetica", "bold");
      doc.text(item.label, xPos, detailY);
      doc.setFont("helvetica", "normal");
      doc.text(item.value, xPos + 35, detailY);
      
      if (index % 2 === 0 && index < 2) detailY += 8;
    });
    
    currentY += 50;

    // Medications Section Header
    checkPageBreak(20);
    
    doc.setFillColor(41, 128, 185);
    doc.rect(margin, currentY, contentWidth, 15, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("PRESCRIBED MEDICATIONS", margin + 5, currentY + 10);
    
    currentY += 25;

    // Medications List
    prescription.medications.forEach((med, index) => {
      const medHeight = 55;
      
      checkPageBreak(medHeight);
      
      // Medication container
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.rect(margin, currentY, contentWidth, medHeight);
      
      // Medication number badge
      doc.setFillColor(41, 128, 185);
      doc.circle(margin + 15, currentY + 15, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text((index + 1).toString(), margin + 12, currentY + 18);
      
      // Medication name
      doc.setTextColor(33, 37, 41);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(med.name, margin + 35, currentY + 12);
      
      // Medication details
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      
      const details = [
        `Dosage: ${med.dosage}`,
        `Frequency: ${med.frequency}`,
        `Duration: ${med.duration}`
      ];
      
      let detailsY = currentY + 25;
      details.forEach((detail, i) => {
        doc.text(detail, margin + 35, detailsY);
        detailsY += 7;
      });
      
      // Instructions
      if (med.instructions && med.instructions !== 'None') {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        const instructionText = `Instructions: ${med.instructions}`;
        const wrappedInstructions = doc.splitTextToSize(instructionText, contentWidth - 50);
        doc.text(wrappedInstructions, margin + 35, detailsY);
      }
      
      currentY += medHeight + 10;
    });

    // Additional Instructions Section
    if (prescription.additionalInstructions) {
      const instructionsHeight = 40;
      checkPageBreak(instructionsHeight);
      
      doc.setFillColor(252, 248, 227);
      doc.rect(margin, currentY, contentWidth, 15, 'F');
      doc.setDrawColor(251, 191, 36);
      doc.setLineWidth(0.5);
      doc.rect(margin, currentY, contentWidth, instructionsHeight);
      
      doc.setTextColor(133, 100, 4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("⚠ ADDITIONAL INSTRUCTIONS", margin + 5, currentY + 10);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const instructionLines = doc.splitTextToSize(prescription.additionalInstructions, contentWidth - 20);
      doc.text(instructionLines, margin + 10, currentY + 25);
      
      currentY += instructionsHeight + 15;
    }

    // Signature Section
    const signatureHeight = 60;
    checkPageBreak(signatureHeight);
    
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(1);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    
    currentY += 10;
    doc.setTextColor(41, 128, 185);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PHYSICIAN AUTHORIZATION", margin, currentY);
    
    currentY += 15;
    doc.setTextColor(33, 37, 41);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    
    const signatureFields = [
      "Physician Name: _________________________________",
      "License Number: _________________________________",
      "Digital Signature: _______________________________",
      "Date: ___________________________________________"
    ];
    
    signatureFields.forEach(field => {
      doc.text(field, margin, currentY);
      currentY += 10;
    });

    // Footer
    const footerY = pageHeight - 25;
    doc.setFillColor(41, 128, 185);
    doc.rect(0, footerY, pageWidth, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Generated by Ninisina Medical Assistant | This is a computer-generated prescription", margin, footerY + 8);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, footerY + 15);
    
    const patientName = patientInfo?.name || 'patient';
    doc.save(`Medical-Prescription-${patientName.replace(/\s+/g, '-')}-${Date.now()}.pdf`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg border border-blue-100">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 rounded-t-xl">
            <h1 className="text-3xl font-bold flex items-center">
              <Stethoscope className="w-8 h-8 mr-3" />
              E-Prescription System
            </h1>
            <p className="text-blue-100 mt-2">Voice-activated prescription generation</p>
          </div>
          
          {/* Patient Info Display */}
          <div className="p-6 bg-gray-50 border-b">
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
              <User className="w-5 h-5 mr-2 text-blue-600" />
              Patient Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-3 rounded-lg border">
                <span className="text-sm text-gray-600">Name</span>
                <p className="font-semibold">{patientInfo?.name || 'Not provided'}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border">
                <span className="text-sm text-gray-600">Age</span>
                <p className="font-semibold">{patientInfo?.age || 'Not provided'}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border">
                <span className="text-sm text-gray-600">Gender</span>
                <p className="font-semibold">{patientInfo?.gender || 'Not provided'}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border">
                <span className="text-sm text-gray-600">Patient ID</span>
                <p className="font-semibold font-mono text-sm">{patientInfo?.id || generatePatientId()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recording Interface */}
        <div className="bg-white rounded-xl shadow-lg border border-blue-100 p-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center">
            <Pill className="w-6 h-6 mr-3 text-blue-600" />
            Voice Prescription Recorder
          </h2>
          
          <div className="flex flex-col items-center space-y-6">
            <div className="flex items-center space-x-4">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={isProcessing}
                  className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-10 py-4 rounded-xl font-semibold flex items-center space-x-3 transition-all duration-300 transform hover:scale-105 shadow-lg text-lg"
                >
                  <Mic className="w-7 h-7" />
                  <span>Start Recording</span>
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-10 py-4 rounded-xl font-semibold flex items-center space-x-3 transition-all duration-300 transform hover:scale-105 shadow-lg text-lg"
                >
                  <Square className="w-7 h-7" />
                  <span>Stop Recording</span>
                </button>
              )}
              
              {audioBlob && !isRecording && (
                <button
                  onClick={processPrescriptionAudio}
                  disabled={isProcessing}
                  className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-10 py-4 rounded-xl font-semibold flex items-center space-x-3 transition-all duration-300 transform hover:scale-105 shadow-lg text-lg"
                >
                  <Upload className="w-7 h-7" />
                  <span>{isProcessing ? 'Processing...' : 'Generate Prescription'}</span>
                </button>
              )}
            </div>
            
            {isRecording && (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 flex items-center space-x-4">
                <div className="w-6 h-6 bg-red-500 rounded-full animate-pulse"></div>
                <div className="text-center">
                  <div className="text-3xl font-mono font-bold text-red-600">{formatTime(recordingTime)}</div>
                  <p className="text-red-700 font-medium">Recording in progress...</p>
                </div>
              </div>
            )}
            
            {audioBlob && !isRecording && !prescription && !isProcessing && (
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 flex items-center space-x-3">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <div>
                  <p className="text-green-800 font-semibold">Recording completed successfully!</p>
                  <p className="text-green-600 text-sm">Duration: {formatTime(recordingTime)} - Ready to generate prescription</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-6">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <div>
                <h3 className="text-red-800 font-semibold">Error Occurred</h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Processing Status */}
        {isProcessing && (
          <div className="bg-blue-50 border-l-4 border-blue-400 rounded-lg p-6">
            <div className="flex items-center justify-center space-x-4">
              <Activity className="w-10 h-10 text-blue-600 animate-spin" />
              <div className="text-center">
                <h3 className="text-blue-800 font-semibold text-xl">Processing Prescription</h3>
                <p className="text-blue-600 text-lg">{processingStatus || 'Please wait...'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Generated Prescription */}
        {prescription && (
          <div className="bg-white rounded-xl shadow-lg border border-blue-100">
            {/* Prescription Header */}
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white p-6 rounded-t-xl">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-bold flex items-center">
                    <span className="text-3xl mr-3">℞</span>
                    Medical Prescription
                  </h3>
                  <p className="text-green-100 mt-1 flex items-center">
                    <Calendar className="w-4 h-4 mr-2" />
                    Generated on {new Date().toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </p>
                </div>
                <button
                  onClick={downloadPrescription}
                  className="bg-white text-green-600 hover:bg-green-50 px-6 py-3 rounded-lg font-semibold flex items-center space-x-2 transition-colors shadow-lg"
                >
                  <Download className="w-5 h-5" />
                  <span>Download PDF</span>
                </button>
              </div>
            </div>

            {/* Prescription Content */}
            <div className="p-6">
              <div className="space-y-6">
                {prescription.medications.map((med, index) => (
                  <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start space-x-4">
                      <div className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <h4 className="text-xl font-bold text-gray-800 mb-3">{med.name}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <div className="flex items-center">
                              <span className="text-sm font-semibold text-gray-600 w-20">Dosage:</span>
                              <span className="text-gray-800 font-medium">{med.dosage}</span>
                            </div>
                            <div className="flex items-center">
                              <span className="text-sm font-semibold text-gray-600 w-20">Frequency:</span>
                              <span className="text-gray-800 font-medium">{med.frequency}</span>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center">
                              <span className="text-sm font-semibold text-gray-600 w-20">Duration:</span>
                              <span className="text-gray-800 font-medium">{med.duration}</span>
                            </div>
                          </div>
                        </div>
                        {med.instructions && med.instructions !== 'None' && (
                          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                            <span className="text-sm font-semibold text-yellow-800">Instructions:</span>
                            <p className="text-yellow-700 mt-1">{med.instructions}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                {prescription.additionalInstructions && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-amber-800 mb-3 flex items-center">
                      <AlertCircle className="w-5 h-5 mr-2" />
                      Additional Instructions
                    </h4>
                    <p className="text-amber-700 leading-relaxed">{prescription.additionalInstructions}</p>
                  </div>
                )}
              </div>
              
              {/* Prescription Footer */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <p>Prescription ID: <span className="font-mono">{prescription.prescriptionId || `RX${Date.now()}`}</span></p>
                  <p>Generated by Ninisina Medical Assistant</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EPrescription;