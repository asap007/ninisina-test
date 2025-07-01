const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

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
  systemPrompt: `You are Ninisina, an expert medical AI assistant specialized in clinical documentation and analysis. Your purpose is to assist healthcare professionals by processing consultation audio into structured, accurate, and insightful medical data. You must adhere to the highest standards of clinical accuracy and provide evidence-based reasoning. Always output your final analysis in the requested JSON format.`,

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

    {
      "clinicalSummary": {
        "chiefComplaint": "A concise summary of the patient's primary reason for the visit.",
        "historyOfPresentIllness": "A detailed narrative of the patient's current symptoms, including onset, duration, severity, and associated factors.",
        "assessment": "Your clinical assessment, including the most likely diagnosis and rationale.",
        "plan": "A structured plan for patient care, including tests, treatments, and follow-up.",
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
  `
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


// *** RESTORED HELPER FUNCTIONS ***

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

// Helper function to generate follow-up reminders
function generateFollowUpReminders(analysis) {
  const reminders = [];
  if (!analysis || !analysis.medicalInsights) return reminders;
  
  if(analysis.medicalInsights.recommendations) {
    analysis.medicalInsights.recommendations
      .filter(rec => rec.category === 'Follow-up')
      .forEach(rec => {
        rec.items.forEach(item => {
          reminders.push({ type: 'followup', message: item, dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() });
        });
      });
  }

  if (analysis.medicalInsights.redFlags) {
     analysis.medicalInsights.redFlags
        .filter(flag => flag.status === 'Critical')
        .forEach(flag => {
            reminders.push({ type: 'urgent', message: `Urgent Action: ${flag.flag} - ${flag.action}`, dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
        });
  }
  return reminders;
}

// Helper function to calculate confidence score
function calculateConfidenceScore(analysis) {
  if (!analysis || !analysis.medicalInsights) return 0.7;
  let score = 0.7;
  if (analysis.medicalInsights.differentialDiagnosis && analysis.medicalInsights.differentialDiagnosis.length > 1) score += 0.1;
  if (analysis.medicalInsights.redFlags && analysis.medicalInsights.redFlags.length > 0) score += 0.1;
  if (analysis.medicalInsights.clinicalDecisionSupport && analysis.medicalInsights.clinicalDecisionSupport.guidelines) score += 0.1;
  return Math.min(score, 0.98);
}


// --- API ROUTES ---

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Ninisina V1 Medical AI Backend is running' });
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
    const { transcript, patientInfo } = req.body;
    
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    console.log('🔍 Starting full analysis pipeline...');

    const labeledTranscript = await diarizeTranscript(transcript);

    console.log('🔬 Performing clinical analysis on labeled transcript...');
    const analysis = await analyzeMedicalConsultation(labeledTranscript, patientInfo);

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
    const keyPoints = keyPointsText.split('\n').filter(line => line.trim().length > 0).map(line => line.replace(/^[-•*]\s*/, '').trim());

    const followUpReminders = generateFollowUpReminders(analysis);

    console.log('✅ Comprehensive medical analysis completed');

    const response = {
      transcript: labeledTranscript, 
      ...analysis,
      keyPoints: keyPoints,
      followUpReminders: followUpReminders,
      analysisMetadata: {
        processedAt: new Date().toISOString(),
        transcriptLength: labeledTranscript.length,
        patientInfo: patientInfo || {},
        aiModel: 'gpt-4-turbo-preview',
        confidenceScore: calculateConfidenceScore(analysis)
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Medical analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze medical consultation',
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Ninisina Medical AI Backend running on http://localhost:${PORT}`);
  if (OPENAI_API_KEY) {
    console.log('✅ OpenAI API key loaded successfully.');
  } else {
    console.log('⚠️  Warning: OpenAI API key is NOT configured. The application will not work.');
  }
});