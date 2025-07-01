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
    // Use the original name from the frontend for clarity
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
    
    // Clean up the file after successful transcription
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
  const { transcript, patientInfo } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: 'Transcript is required.' });
  }

  try {
    console.log('🔍 Performing comprehensive medical analysis...');
    
    const analysisResponse = await callOpenAI('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-4-turbo-preview', // Or a newer model
            messages: [
                { role: 'system', content: MEDICAL_PROMPTS.systemPrompt },
                { role: 'user', content: MEDICAL_PROMPTS.analysisPrompt(transcript, patientInfo) }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
            max_tokens: 3000,
        }),
    });

    const analysisContent = analysisResponse.choices[0].message.content;
    const analysisJson = JSON.parse(analysisContent);

    // Generate follow-up reminders based on analysis
    const followUpReminders = [];
    analysisJson.medicalInsights.recommendations
      .filter(rec => rec.category === 'Follow-up')
      .forEach(rec => {
        rec.items.forEach(item => {
          followUpReminders.push({ type: 'followup', message: item, dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() }); // Default 2 weeks
        });
      });
     analysisJson.medicalInsights.redFlags
        .filter(flag => flag.status === 'Critical')
        .forEach(flag => {
            followUpReminders.push({ type: 'urgent', message: `Urgent Action: ${flag.flag} - ${flag.action}`, dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }); // 24 hours
        });


    console.log('✅ Analysis complete.');
    res.json({
        transcript,
        ...analysisJson, // Spread the contents of the AI's response
        followUpReminders,
        analysisMetadata: {
            processedAt: new Date().toISOString(),
            aiModel: 'gpt-4-turbo-preview',
        },
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze transcript.', details: error.message });
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