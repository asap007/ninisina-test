const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ninisina_medical';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB successfully');
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// MongoDB Schema for Consultations
const consultationSchema = new mongoose.Schema({
  consultationId: {
    type: String,
    required: true,
    unique: true,
    default: () => `CONS-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  },
  patientInfo: {
    name: String,
    age: Number,
    gender: String,
    visitType: String,
    patientId: String
  },
  transcript: {
    type: String,
    required: true
  },
  clinicalSummary: {
    chiefComplaint: String,
    historyOfPresentIllness: String,
    assessment: String,
    plan: mongoose.Schema.Types.Mixed,
    vitals: String,
    riskFactors: [String]
  },
  medicalInsights: {
    differentialDiagnosis: [{
      condition: String,
      probability: String,
      reasoning: String,
      icd10: String
    }],
    redFlags: [{
      flag: String,
      status: String,
      action: String
    }],
    recommendations: [{
      category: String,
      items: [String]
    }],
    clinicalDecisionSupport: {
      guidelines: String,
      evidenceLevel: String,
      recommendedActions: [String]
    }
  },
  keyPoints: [String],
  followUpReminders: [{
    type: { type: String },
    message: { type: String },
    dueDate: { type: Date }
  }],
  analysisMetadata: {
    processedAt: {
      type: Date,
      default: Date.now
    },
    transcriptLength: Number,
    aiModel: String,
    confidenceScore: Number,
    consultationDuration: String
  },
  prescriptions: [{
    prescriptionId: String,
    medications: [{
      name: String,
      dosage: String,
      frequency: String,
      duration: String,
      instructions: String
    }],
    additionalInstructions: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
consultationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Consultation = mongoose.model('Consultation', consultationSchema);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

if (!OPENAI_API_KEY) {
  console.error('⚠️  OPENAI_API_KEY environment variable is required.');
  console.log('Please create a .env file and set your OpenAI API key: OPENAI_API_KEY=your_key_here');
}

// --- AI Prompts for Medical Analysis ---
const MEDICAL_PROMPTS = {
  systemPrompt: `You are Ninisina, an expert medical AI assistant specialized in clinical documentation and analysis. Your purpose is to assist healthcare professionals by processing consultation audio into structured, accurate, and insightful medical data. You must adhere to the highest standards of clinical accuracy and provide evidence-based reasoning. Always output your final analysis in the requested JSON format with proper string formatting.`,

  analysisPrompt: (transcript, patientInfo) => `
    PATIENT INFORMATION:
    Name: ${patientInfo.name || 'Not Provided'}
    Age: ${patientInfo.age || 'Not Provided'}
    Gender: ${patientInfo.gender || 'Not Provided'}
    Visit Type: ${patientInfo.visitType || 'Not Provided'}

    CONSULTATION TRANSCRIPT:
    """
    ${transcript}
    """

    Based on the provided transcript and patient information, perform a comprehensive medical analysis. Generate a response in the following strict JSON format ONLY. Do not include any text or markdown formatting outside of the JSON object.

    IMPORTANT: All field values must be strings or properly formatted arrays. Do not use nested objects for simple fields.

    {
      "clinicalSummary": {
        "chiefComplaint": "A concise summary of the patient's primary reason for the visit.",
        "historyOfPresentIllness": "A detailed narrative of the patient's current symptoms, including onset, duration, severity, and associated factors.",
        "assessment": "Your clinical assessment, including the most likely diagnosis and rationale.",
        "plan": "A structured plan for patient care as a formatted string. Include: Immediate Treatment: [details], Follow-up Treatment: [details], Additional Care: [details]",
        "vitals": "Vital signs if mentioned in the transcript, otherwise 'Not recorded'.",
        "riskFactors": ["List of relevant risk factors identified from the conversation."]
      },
      "medicalInsights": {
          "differentialDiagnosis": [
            {
              "condition": "Primary or alternative diagnosis",
              "probability": "High | Moderate | Low (e.g., 'High (approx. 85%)')",
              "reasoning": "Brief clinical reasoning based on transcript evidence.",
              "icd10": "The most appropriate ICD-10 code."
            }
          ],
          "redFlags": [
            {
              "flag": "Any symptom or finding that requires urgent attention.",
              "status": "Critical | Monitor | Noted",
              "action": "Recommended immediate action for this flag."
            }
          ],
          "recommendations": [
            {
              "category": "Immediate",
              "items": ["Actionable recommendations for immediate consideration."]
            },
            {
              "category": "Follow-up",
              "items": ["Recommendations for future appointments or monitoring."]
            },
            {
              "category": "Lifestyle",
              "items": ["Suggestions for lifestyle changes, diet, exercise, etc."]
            }
          ],
          "clinicalDecisionSupport": {
            "guidelines": "Mention relevant clinical guidelines (e.g., 'AHA/ACC Guidelines for Hypertension').",
            "evidenceLevel": "Level A | Level B | Level C",
            "recommendedActions": ["Key actions supported by evidence."]
          }
        }
    }
  `,

  prescriptionPrompt: (transcript, patientInfo) => `
    PATIENT INFORMATION:
    Name: ${patientInfo.name || 'Not Provided'}
    Age: ${patientInfo.age || 'Not Provided'}
    Gender: ${patientInfo.gender || 'Not Provided'}
    Visit Type: ${patientInfo.visitType || 'Not Provided'}

    PRESCRIPTION TRANSCRIPT:
    """
    ${transcript}
    """

    You are tasked with generating a structured e-prescription based on the doctor's verbal instructions in the transcript. Extract medication details (name, dosage, frequency, duration, instructions) and any additional instructions. Output in the following strict JSON format ONLY:

    {
      "prescriptionId": "Generate a unique ID using timestamp",
      "medications": [
        {
          "name": "Medication name",
          "dosage": "Dosage amount (e.g., 500 mg)",
          "frequency": "Frequency of administration (e.g., twice daily)",
          "duration": "Duration of treatment (e.g., 7 days)",
          "instructions": "Specific instructions or null if none"
        }
      ],
      "additionalInstructions": "Any additional instructions or null if none"
    }
  `,
};

// Helper function to make OpenAI API calls
async function callOpenAI(endpoint, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          ...options.headers
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error (${response.status}): ${errorText}`);
      }
      return response.json();
    } catch (error) {
      console.error(`OpenAI API attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1))); // Exponential backoff
    }
  }
}

// New helper function for speaker diarization
async function diarizeTranscript(transcript) {
  console.log('🗣️  Applying speaker diarization...');
  
  const diarizationPrompt = `
You are a highly accurate AI assistant specializing in processing medical transcripts.
Your task is to add speaker labels ("Doctor:" and "Patient:") to the following raw transcript.
The conversation is between a doctor and a patient. Analyze the dialogue to correctly identify who is speaking at each turn.
Maintain the original wording precisely. Do not add any extra text, summary, or commentary.
Your output should ONLY be the formatted transcript with the added labels.

RAW TRANSCRIPT:
"""
${transcript}
"""

FORMATTED TRANSCRIPT:
  `;

  try {
    const response = await callOpenAI('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: diarizationPrompt }],
        temperature: 0.0,
        max_tokens: transcript.length + 500,
      }),
    });

    const labeledTranscript = response.choices[0].message.content.trim();
    console.log('✅ Diarization complete.');
    return labeledTranscript;
  } catch (error) {
    console.error('Diarization failed:', error);
    return transcript;
  }
}

// Enhanced medical analysis function
async function analyzeMedicalConsultation(transcript, patientInfo = {}) {
  const analysisPrompt = MEDICAL_PROMPTS.analysisPrompt(transcript, patientInfo);
  try {
    const response = await callOpenAI('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: MEDICAL_PROMPTS.systemPrompt },
          { role: 'user', content: analysisPrompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 3000,
        temperature: 0.3
      })
    });
    const analysisContent = response.choices[0].message.content;
    return JSON.parse(analysisContent);
  } catch (error) {
    console.error('Medical analysis AI call error:', error);
    throw error;
  }
}

// Data sanitization function
function sanitizeAnalysisData(analysis) {
  try {
    // Handle plan field - convert object to string if needed
    if (analysis.clinicalSummary && analysis.clinicalSummary.plan) {
      if (typeof analysis.clinicalSummary.plan === 'object') {
        // Convert object to formatted string
        if (analysis.clinicalSummary.plan.immediateTreatment) {
          analysis.clinicalSummary.plan = 
            `Immediate Treatment: ${analysis.clinicalSummary.plan.immediateTreatment}\n` +
            `Follow-up Treatment: ${analysis.clinicalSummary.plan.followUpTreatment || 'Not specified'}\n` +
            `Additional Care: ${analysis.clinicalSummary.plan.additionalCare || 'Not specified'}`;
        } else {
          analysis.clinicalSummary.plan = JSON.stringify(analysis.clinicalSummary.plan);
        }
      }
    }

    // Ensure all required nested objects exist
    if (!analysis.clinicalSummary) analysis.clinicalSummary = {};
    if (!analysis.medicalInsights) analysis.medicalInsights = {};
    
    // Ensure arrays exist and are properly formatted
    if (!Array.isArray(analysis.medicalInsights.recommendations)) {
      analysis.medicalInsights.recommendations = [];
    }
    
    if (!Array.isArray(analysis.medicalInsights.redFlags)) {
      analysis.medicalInsights.redFlags = [];
    }
    
    if (!Array.isArray(analysis.medicalInsights.differentialDiagnosis)) {
      analysis.medicalInsights.differentialDiagnosis = [];
    }

    // Ensure clinicalDecisionSupport exists
    if (!analysis.medicalInsights.clinicalDecisionSupport) {
      analysis.medicalInsights.clinicalDecisionSupport = {
        guidelines: "",
        evidenceLevel: "",
        recommendedActions: []
      };
    }

    return analysis;
  } catch (error) {
    console.error('Error sanitizing analysis data:', error);
    return analysis;
  }
}

// Helper function to generate follow-up reminders
function generateFollowUpReminders(analysis) {
  const reminders = [];
  
  // Check if analysis and medicalInsights exist
  if (!analysis || !analysis.medicalInsights) {
    console.warn('⚠️ Analysis or medicalInsights is missing');
    return reminders;
  }
  
  // Safely handle recommendations
  if (analysis.medicalInsights.recommendations && Array.isArray(analysis.medicalInsights.recommendations)) {
    try {
      analysis.medicalInsights.recommendations
        .filter(rec => rec && rec.category === 'Follow-up' && Array.isArray(rec.items))
        .forEach(rec => {
          rec.items.forEach(item => {
            if (item && typeof item === 'string') {
              reminders.push({ 
                type: 'followup', 
                message: item, 
                dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) 
              });
            }
          });
        });
    } catch (error) {
      console.error('Error processing recommendations for follow-up reminders:', error);
    }
  }

  // Safely handle redFlags
  if (analysis.medicalInsights.redFlags && Array.isArray(analysis.medicalInsights.redFlags)) {
    try {
      analysis.medicalInsights.redFlags
        .filter(flag => flag && flag.status === 'Critical')
        .forEach(flag => {
          if (flag.flag && flag.action) {
            reminders.push({ 
              type: 'urgent', 
              message: `Urgent Action: ${flag.flag} - ${flag.action}`, 
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000) 
            });
          }
        });
    } catch (error) {
      console.error('Error processing redFlags for follow-up reminders:', error);
    }
  }
  
  return reminders;
}

// Helper function to calculate confidence score
function calculateConfidenceScore(analysis) {
  if (!analysis || !analysis.medicalInsights) {
    console.warn('⚠️ Analysis or medicalInsights missing for confidence calculation');
    return 0.7;
  }
  
  let score = 0.7; // Base score

  try {
    // Check differential diagnosis
    if (analysis.medicalInsights.differentialDiagnosis && 
        Array.isArray(analysis.medicalInsights.differentialDiagnosis) && 
        analysis.medicalInsights.differentialDiagnosis.length > 1) {
      score += 0.1;
    }

    // Check red flags
    if (analysis.medicalInsights.redFlags && 
        Array.isArray(analysis.medicalInsights.redFlags) && 
        analysis.medicalInsights.redFlags.length > 0) {
      score += 0.1;
    }

    // Check clinical decision support
    if (analysis.medicalInsights.clinicalDecisionSupport && 
        analysis.medicalInsights.clinicalDecisionSupport.guidelines) {
      score += 0.1;
    }
  } catch (error) {
    console.error('Error calculating confidence score:', error);
  }

  return Math.min(score, 0.98);
}

// --- API ROUTES ---

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'Ninisina V1 Medical AI Backend is running',
    mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// 1. Upload audio file
app.post('/upload', upload.single('audio'), (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided.' });
  }
  console.log(`📁 Audio file uploaded: ${req.file.filename}`);
  res.json({
    message: 'File uploaded successfully.',
    filename: req.file.filename,
  });
});

// 2. Transcribe audio file
app.post('/transcribe', async (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'Filename is required.' });
  }

  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Audio file not found on server.' });
  }

  try {
    console.log(`🎤 Transcribing: ${filename}`);
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    formData.append('prompt', 'This is a medical consultation between a doctor and a patient. Key terms include symptoms, diagnosis, medication, hypertension, diabetes, migraine, etc.');

    const transcriptionResult = await callOpenAI('/audio/transcriptions', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    console.log(`✅ Transcription successful for: ${filename}`);
    res.json({ transcript: transcriptionResult.text });
    
    fs.unlink(filePath, (err) => {
      if (err) console.error(`Error deleting temp file ${filePath}:`, err);
      else console.log(`🗑️ Cleaned up file: ${filename}`);
    });

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio.', details: error.message });
  }
});

// 3. Analyze transcript
app.post('/analyze', async (req, res) => {
  try {
    const { transcript, patientInfo, consultationDuration } = req.body;
    
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    console.log('🔍 Starting full analysis pipeline...');

    const labeledTranscript = await diarizeTranscript(transcript);

    console.log('🔬 Performing clinical analysis on labeled transcript...');
    let analysis;
    let sanitizedAnalysis; // Declare sanitizedAnalysis here
    try {
      analysis = await analyzeMedicalConsultation(labeledTranscript, patientInfo);
      
      // Validate analysis structure
      if (!analysis || typeof analysis !== 'object') {
        throw new Error('Invalid analysis response from AI');
      }
      
      // Sanitize the analysis data
      sanitizedAnalysis = sanitizeAnalysisData(analysis);
      
    } catch (aiError) {
      console.error('AI Analysis failed:', aiError);
      // Provide fallback analysis structure
      sanitizedAnalysis = {
        clinicalSummary: {
          chiefComplaint: "Unable to extract - AI analysis failed",
          historyOfPresentIllness: "Unable to extract - AI analysis failed",
          assessment: "Unable to extract - AI analysis failed",
          plan: "Unable to extract - AI analysis failed",
          vitals: "Not recorded",
          riskFactors: []
        },
        medicalInsights: {
          differentialDiagnosis: [],
          redFlags: [],
          recommendations: [],
          clinicalDecisionSupport: {
            guidelines: "",
            evidenceLevel: "",
            recommendedActions: []
          }
        }
      };
    }

    // Generate key points with error handling
    let keyPoints = [];
    try {
      const keyPointsPrompt = `Extract the most important clinical points from this medical consultation transcript:\n\n"${labeledTranscript}"\n\nProvide 5-8 concise bullet points.`;
      const keyPointsResponse = await callOpenAI('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4-turbo-preview',
          messages: [
            { role: 'system', content: 'You are a medical scribe extracting key clinical points.' },
            { role: 'user', content: keyPointsPrompt }
          ],
          max_tokens: 800,
          temperature: 0.3
        })
      });
      const keyPointsText = keyPointsResponse.choices[0].message.content;
      keyPoints = keyPointsText.split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.replace(/^[-•*]\s*/, '').trim());
    } catch (keyPointsError) {
      console.error('Key points extraction failed:', keyPointsError);
      keyPoints = ['Key points extraction failed - please review transcript manually'];
    }

    // Generate follow-up reminders and confidence score with error handling
    const followUpReminders = generateFollowUpReminders(sanitizedAnalysis);
    const confidenceScore = calculateConfidenceScore(sanitizedAnalysis);

    // Save to MongoDB
    console.log('💾 Saving consultation to database...');
    try {
      const consultation = new Consultation({
        patientInfo: patientInfo || {},
        transcript: labeledTranscript,
        clinicalSummary: sanitizedAnalysis.clinicalSummary,
        medicalInsights: sanitizedAnalysis.medicalInsights,
        keyPoints: keyPoints,
        followUpReminders: followUpReminders,
        analysisMetadata: {
          processedAt: new Date(),
          transcriptLength: labeledTranscript.length,
          aiModel: 'gpt-4-turbo-preview',
          confidenceScore: confidenceScore,
          consultationDuration: consultationDuration || 'N/A'
        }
      });

      const savedConsultation = await consultation.save();
      console.log(`✅ Consultation saved with ID: ${savedConsultation.consultationId}`);

      console.log('✅ Comprehensive medical analysis completed');

      const response = {
        consultationId: savedConsultation.consultationId,
        transcript: labeledTranscript, 
        ...sanitizedAnalysis,
        keyPoints: keyPoints,
        followUpReminders: followUpReminders,
        analysisMetadata: {
          processedAt: new Date().toISOString(),
          transcriptLength: labeledTranscript.length,
          patientInfo: patientInfo || {},
          aiModel: 'gpt-4-turbo-preview',
          confidenceScore: confidenceScore
        }
      };

      res.json(response);
      
    } catch (dbError) {
      console.error('Database save error:', dbError);
      // Still return the analysis even if DB save fails
      const response = {
        consultationId: `TEMP-${Date.now()}`, // Temporary ID
        transcript: labeledTranscript, 
        ...sanitizedAnalysis,
        keyPoints: keyPoints,
        followUpReminders: followUpReminders,
        analysisMetadata: {
          processedAt: new Date().toISOString(),
          transcriptLength: labeledTranscript.length,
          patientInfo: patientInfo || {},
          aiModel: 'gpt-4-turbo-preview',
          confidenceScore: confidenceScore
        },
        warning: 'Analysis completed but not saved to database'
      };

      res.json(response);
    }

  } catch (error) {
    console.error('Medical analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze medical consultation',
      details: error.message 
    });
  }
});

// 4. Generate prescription and save to consultation
app.post('/generate-prescription', async (req, res) => {
  try {
    const { transcript, patientInfo, consultationId } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    console.log('💊 Generating e-prescription...');
    const prescriptionPrompt = MEDICAL_PROMPTS.prescriptionPrompt(transcript, patientInfo);
    
    const response = await callOpenAI('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: MEDICAL_PROMPTS.systemPrompt },
          { role: 'user', content: prescriptionPrompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
        temperature: 0.3
      })
    });

    const prescriptionData = JSON.parse(response.choices[0].message.content);
    prescriptionData.prescriptionId = `RX-${Date.now()}`; // Ensure unique ID

    // If consultationId is provided, add prescription to existing consultation
    if (consultationId) {
      try {
        const consultation = await Consultation.findOne({ consultationId });
        if (consultation) {
          consultation.prescriptions.push(prescriptionData);
          await consultation.save();
          console.log(`✅ Prescription added to consultation ${consultationId}`);
        }
      } catch (dbError) {
        console.error('Error saving prescription to consultation:', dbError);
        // Continue with response even if DB save fails
      }
    }

    // ===================== MODIFICATION START =====================
    // Combine prescription data with the transcript for the response
    const responseData = {
      ...prescriptionData,
      transcript: transcript
    };

    console.log('✅ E-prescription generated successfully');
    res.json(responseData);
    // ===================== MODIFICATION END =======================

  } catch (error) {
    console.error('E-prescription generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate e-prescription',
      details: error.message 
    });
  }
});

// 5. Save consultation to MongoDB (Manual save endpoint)
app.post('/consultations', async (req, res) => {
  try {
    const consultationData = req.body;

    // Validate required fields
    if (!consultationData.transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const consultation = new Consultation(consultationData);
    const savedConsultation = await consultation.save();

    console.log(`✅ Consultation manually saved with ID: ${savedConsultation.consultationId}`);
    res.status(201).json({
      message: 'Consultation saved successfully',
      consultationId: savedConsultation.consultationId,
      consultation: savedConsultation
    });

  } catch (error) {
    console.error('Error saving consultation:', error);
    if (error.code === 11000) {
      res.status(400).json({ error: 'Consultation with this ID already exists' });
    } else {
      res.status(500).json({ 
        error: 'Failed to save consultation',
        details: error.message 
      });
    }
  }
});

// 6. Retrieve consultation history with pagination and filtering
app.get('/consultations', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      patientName, 
      patientId, 
      startDate, 
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    if (patientName) {
      filter['patientInfo.name'] = new RegExp(patientName, 'i');
    }
    if (patientId) {
      filter['patientInfo.patientId'] = patientId;
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const consultations = await Consultation.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-transcript') // Exclude full transcript for performance
      .lean();

    const total = await Consultation.countDocuments(filter);

    console.log(`📋 Retrieved ${consultations.length} consultations (page ${page})`);

    res.json({
      consultations,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / parseInt(limit)),
        count: consultations.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Error retrieving consultations:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve consultations',
      details: error.message 
    });
  }
});

// 7. Retrieve a specific consultation by ID
app.get('/consultations/:consultationId', async (req, res) => {
  try {
    const { consultationId } = req.params;

    const consultation = await Consultation.findOne({ consultationId }).lean();

    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    console.log(`📋 Retrieved consultation: ${consultationId}`);
    res.json(consultation);

  } catch (error) {
    console.error('Error retrieving consultation:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve consultation',
      details: error.message 
    });
  }
});

// 8. Delete consultation by ID
app.delete('/consultations/:consultationId', async (req, res) => {
  try {
    const { consultationId } = req.params;

    const deletedConsultation = await Consultation.findOneAndDelete({ consultationId });

    if (!deletedConsultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    console.log(`🗑️ Deleted consultation: ${consultationId}`);
    res.json({ 
      message: 'Consultation deleted successfully',
      consultationId: deletedConsultation.consultationId
    });

  } catch (error) {
    console.error('Error deleting consultation:', error);
    res.status(500).json({ 
      error: 'Failed to delete consultation',
      details: error.message 
    });
  }
});

// 9. Update consultation by ID
app.put('/consultations/:consultationId', async (req, res) => {
  try {
    const { consultationId } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated
    delete updateData._id;
    delete updateData.consultationId;
    delete updateData.createdAt;

    const updatedConsultation = await Consultation.findOneAndUpdate(
      { consultationId },
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!updatedConsultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    console.log(`✅ Updated consultation: ${consultationId}`);
    res.json({
      message: 'Consultation updated successfully',
      consultation: updatedConsultation
    });

  } catch (error) {
    console.error('Error updating consultation:', error);
    res.status(500).json({ 
      error: 'Failed to update consultation',
      details: error.message 
    });
  }
});

// 10. Get consultation statistics
app.get('/stats/consultations', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    const [totalStats, recentStats] = await Promise.all([
      Consultation.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            totalConsultations: { $sum: 1 },
            avgConfidenceScore: { $avg: '$analysisMetadata.confidenceScore' },
            totalPatients: { $addToSet: '$patientInfo.patientId' }
          }
        }
      ]),
      Consultation.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    const stats = {
      total: totalStats[0] || { totalConsultations: 0, avgConfidenceScore: 0, totalPatients: [] },
      dailyTrend: recentStats,
      uniquePatients: totalStats[0] ? totalStats[0].totalPatients.length : 0
    };

    res.json(stats);

  } catch (error) {
    console.error('Error retrieving consultation stats:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve consultation statistics',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Global Error Handler:', error);
  if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: `File upload error: ${error.message}` });
  }
  res.status(500).json({
    error: 'An internal server error occurred',
    details: error.message,
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed.');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Ninisina Medical AI Backend running on http://localhost:${PORT}`);
  if (OPENAI_API_KEY) {
    console.log('✅ OpenAI API key loaded successfully.');
  } else {
    console.log('⚠️  Warning: OpenAI API key is NOT configured. The application will not work.');
  }
  console.log(`🔗 MongoDB URI: ${MONGODB_URI}`);
});