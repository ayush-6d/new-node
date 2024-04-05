

require("dotenv").config();
const express = require('express');
const cors = require('cors');
const bodyParser = require("body-parser");
const multer = require('multer');
const mongoose = require('mongoose');
const Resume = require('./models/resume');
const UserQuestions = require('./models/UserQuestions');
const UserModel = require("./models/user_model");
const Result = require('./models/Result'); 
const userRoute = require("./routes/user_route");
const authMiddleware = require('./middleware/authmiddleware');
const fs = require('fs');
const config = require('./config');


const { PDFLoader } = require("langchain/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { CohereEmbeddings } = require("@langchain/cohere");
const { HNSWLib } = require("@langchain/community/vectorstores/hnswlib");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const {
  RunnablePassthrough,
  RunnableSequence,
} = require("@langchain/core/runnables");
const { Document } = require("@langchain/core/documents");
const { ChatAnthropic } = require("@langchain/anthropic");

const app = express();
const port = process.env.PORT || 5000;

const COHERE_API_KEY = process.env.COHERE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

mongoose.connect(config.mongodb.uri, config.mongodb.options)
  .then(() => {
    console.log("MongoDB connected successfully");
    // Place any additional logic that depends on the MongoDB connection here
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    // Handle connection error or retry connection
  });

app.use(cors());
app.use(express.json());

app.use(require("./routes/user_route"));


mongoose.connect(config.mongodb.uri, config.mongodb.options)
  .then(() => console.log("Database Connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Use the authentication middleware
// app.use(authMiddleware);

const upload = multer({ dest: 'uploads/' });

// Define a route handler for the GET request to fetch the list of users
app.get('/users', async (req, res) => {
  try {
    // Fetch the list of users from the database
    const users = await UserModel.find();

    // Return the list of users as a JSON response
    res.status(200).json(users);
  } catch (error) {
    // Handle errors and return an error response
    console.error('Error fetching user list:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/submit-resume', upload.single('resume'), async (req, res) => {
  let filePath;
  try {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }


    if (!req.file) {
      return res.status(400).json({ message: 'No resume file uploaded' });
    }
    filePath = req.file.path;

    const loader = new PDFLoader(filePath);
    const docs = await loader.load();

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 20,
    });

    const splittedDocs = await splitter.splitDocuments(docs);

    const userId = req.user._id;

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const fileContent = fs.readFileSync(filePath);

    const newResume = new Resume({
      userId: userId,
      email: user.email,
  fullName: user.fullName,
      resume: {
        data: fileContent,
        contentType: req.file.mimetype
      },
    });

    await newResume.save();

    res.status(201).json({ message: 'Resume submitted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    // Cleanup: delete the uploaded file
    if (filePath) {
      fs.unlinkSync(filePath);
    }
  }
});

async function retrieveAnswerFromResume(userId, question) {
  try {
    const resume = await Resume.findOne({ userId });
    if (!resume) {
      throw new Error('No resume found');
    }

    const resumeText = resume.resumeText;

    // Initialize the components for retrieving the answer
    const vectorstore = await HNSWLib.fromDocuments(
      [{ pageContent: resumeText, metadata: {} }],
      new CohereEmbeddings({ apiKey: COHERE_API_KEY })
    );
    const retriever = vectorstore.asRetriever();
    const model = new ChatAnthropic(ANTHROPIC_API_KEY);
    const template = `Answer the question based only on the following context:
    {context}

    Question: {question}`;
    const prompt = PromptTemplate.fromTemplate(template);
    const formatDocs = (docs) => docs.map((doc) => doc.pageContent);

    // Construct the retrieval chain
    const retrievalChain = RunnableSequence.from([
      { context: retriever.pipe(formatDocs), question: new RunnablePassthrough() },
      prompt,
      model,
      new StringOutputParser(),
    ]);

    // Invoke the retrieval chain to get the answer
    const answer = await retrievalChain.invoke(question);

    return answer;
  } catch (error) {
    console.error("Error retrieving answer from resume:", error);
    throw error;
  }
}

app.post('/ask-question', async (req, res) => {
  try {
    const { question } = req.body;
    console.log('Request Body:', req.body);

    if (!req.user || !question) {
      return res.status(400).json({ message: 'User ID and Question are required' });
    }

    const userId = req.user._id;
    const answer = await retrieveAnswerFromResume(userId, question);

    // Find user's questions document or create a new one if it doesn't exist
    let userQuestions = await UserQuestions.findOne({ userId });
    if (!userQuestions) {
      userQuestions = new UserQuestions({ userId, questions: [] });
    }

    // Store the new question-answer pair
    userQuestions.questions.push({ question, answer });

    // Save the updated user questions document
    await userQuestions.save();

    console.log('Answer:', answer);
    res.status(200).json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// app.get('/shortlist-candidates', async (req, res) => {
//   try {
//     // Check if the user is authenticated
//     if (!req.user) {
//       return res.status(401).json({ error: "User not authenticated" });
//     }

//     // Get the user ID from the authenticated user
//     const userId = req.user._id;

//     // Fetch the authenticated user's information from UserModel
//     const user = await UserModel.findById(userId);

//     // Fetch all user questions for the current user
//     const userQuestions = await UserQuestions.findOne({ userId });

//     // If no user questions found, return empty array
//     if (!userQuestions || !userQuestions.questions || userQuestions.questions.length === 0) {
//       return res.status(404).json({ message: 'No user questions found' });
//     }

//     // Define the minimum accuracy required for shortlisting (60%)
//     const MINIMUM_ACCURACY = 60;

//     // Initialize an array to store shortlisted candidates
//     const shortlistedCandidates = [];

//     // Iterate through each question-answer pair
//     let correctAnswersCount = 0;
//     for (const { answer } of userQuestions.questions) {
//       // Check if the answer starts with "Unfortunately" (considered wrong)
//       if (answer && !answer.trim().startsWith('Unfortunately')) {
//         // If the answer is correct, increment the count of correct answers
//         correctAnswersCount++;
//       }
//     }

//     // Calculate accuracy based on the number of correct answers
//     const accuracy = (correctAnswersCount / userQuestions.questions.length) * 100;

//     // Check if the accuracy meets or exceeds the minimum threshold
//     if (accuracy >= MINIMUM_ACCURACY) {
//       // Prepare the shortlisted candidate
//       const shortlistedCandidate = {
//         userId: user._id,
//         fullName: user.fullName,
//         email: user.email,
//         accuracy: accuracy.toFixed(2),
//         totalQuestionsAsked: userQuestions.questions.length
//       };

//       // Add the shortlisted candidate to the array
//       shortlistedCandidates.push(shortlistedCandidate);
//     }

//     // Return the array of shortlisted candidates
//     return res.status(200).json(shortlistedCandidates);

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

app.get('/shortlist-candidates', async (req, res) => {
  try {
    // Fetch all users
    const users = await UserModel.find();

    // Array to store shortlisted candidates
    const shortlistedCandidates = [];

    // Iterate through each user
    for (const user of users) {
      // Fetch user questions
      const userQuestions = await UserQuestions.findOne({ userId: user._id });

      // If no questions found for the user, continue to the next user
      if (!userQuestions || !userQuestions.questions || userQuestions.questions.length === 0) {
        continue;
      }

      // Initialize variables for correct answers count and total questions asked
      let correctAnswersCount = 0;
      let totalQuestionsAsked = userQuestions.questions.length;

      // Calculate correct answers count
      for (const { answer } of userQuestions.questions) {
        if (answer && !answer.trim().startsWith('Unfortunately')) {
          correctAnswersCount++;
        }
      }

      // Calculate accuracy
      const accuracy = (correctAnswersCount / totalQuestionsAsked) * 100;

      // Check if accuracy meets or exceeds the minimum threshold (60%)
      if (accuracy >= 60) {
        // Prepare shortlisted candidate object
        const shortlistedCandidate = {
          userId: user._id,
          fullName: user.fullName,
          email: user.email,
          accuracy: accuracy.toFixed(2),
          totalQuestionsAsked
        };

        // Add shortlisted candidate to the array
        shortlistedCandidates.push(shortlistedCandidate);
      }
    }

    // Return array of shortlisted candidates
    return res.status(200).json(shortlistedCandidates);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});





