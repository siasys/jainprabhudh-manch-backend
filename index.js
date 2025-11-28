const express = require("express");
const http = require("http");
const dbConnect = require("./config/dbConnect");
const app = express();
const path = require('path')
const dotenv = require("dotenv");
const helmet = require('helmet');
dotenv.config();
console.log("Loaded JWT_SECRET:", process.env.JWT_SECRET);
const PORT = 4000;
const { initializeWebSocket } = require('./websocket/socket'); 
const session = require('express-session');
const upload = require('./middlewares/upload')
const bodyParser = require("body-parser");
const { notFound, errorHandler } = require("./middlewares/errorHandler");
const cors = require("cors");
const adminRouter = require('./admin/route/adminRoute');
const authRouter = require('./routes/UserRegistrationRoutes/authRoute')
const { logMiddleware, authMiddleware, isAdmin } = require('./middlewares/authMiddlewares');
const jainAdharRouter = require('./routes/UserRegistrationRoutes/jainAdharRoute');
const friendshipRoutes = require('./routes/SocialMediaRoutes/friendshipRoutes');
const postRoutes = require('./routes/SocialMediaRoutes/postRoutes'); 
const messageRoutes = require('./routes/SocialMediaRoutes/messageRoutes');
const tirthSanrakshanRoute = require('./routes/TirthSanrakshanRoute');
const ShanghatanIdPasswordRoute = require('./routes/ShanghatanIdPasswordRoute')
const panchayatIdPasswordRoutes = require('./routes/panchayatIdPasswordRoutes');
const tirthIdPasswordRoutes = require('./routes/tirthIdPasswordRoutes')
const jainVyaparRoute = require('./routes/JainVyaparIdPassRoutes');
const sadhuRoutes = require('./routes/SadhuRoutes/sadhuRoutes');
const sadhuPostRoutes = require('./routes/SadhuRoutes/sadhuPostRoutes');
const biodataRoutes = require('./routes/Matrimonial/vyavahikBiodata');
const groupChatRoutes = require('./routes/SocialMediaRoutes/groupChatRoutes');
const rojgarRoutes = require('./routes/Rojgar/rojgarRoute');
const reportingRoutes = require('./routes/ReportingRoutes/reportingRoutes');
const suggestionComplaintRoutes = require('./routes/SuggestionComplaintRoutes/suggestionComplaintRoutes');
const granthRoutes = require('./routes/jainGranthRoutes');
const jainItihasRoutes = require('./routes/jainItihasRoutes');
const storyRoutes = require('./routes/SocialMediaRoutes/storyRoutes');
const notificationRoutes = require('./routes/SocialMediaRoutes/notificationRoutes')
const govtYojanaRoutes = require('./routes/govtYojanaRoutes');
const hierarchicalSanghRoutes = require('./routes/SanghRoutes/hierarchicalSanghRoute');
const sanghAccessRoutes = require('./routes/SanghRoutes/sanghAccessRoute');
const locationRoutes = require('./routes/locationRoutes')
const panchPostRoutes = require('./routes/SanghRoutes/panchPostRoutes');
const sanghPostRoutes = require('./routes/SanghRoutes/sanghPostRoutes');
const panchayatRoutes = require('./routes/SanghRoutes/panchRoutes');
const tirthRoutes = require('./routes/TirthRoutes/tirthRoutes');
const tirthPostRoutes = require('./routes/TirthRoutes/tirthPostRoutes');
const { scheduleStoryCleanup } = require('./jobs/storyCleanupJob');
const vyaparRoutes = require('./routes/VyaparRoutes/vyaparRoutes');
const vyaparPostRoutes = require('./routes/VyaparRoutes/vyaparPostRoutes');
const inquiryRoutes = require('./routes/SanghRoutes/inquiryRoutes');
const paymentRoute = require('./routes/SanghRoutes/paymentRoutes');
const contactUsRoutes = require('./routes/UserRegistrationRoutes/contactUsRoutes');
const foundationPaymentRoutes = require('./routes/Foundation/foundationPaymentRoutes')
const bailorRoutes = require('./routes/Bailors/bailors');
const jainPratibhaRoutes = require('./routes/Jain Prathibha/jainPratibhaRoutes');
const jainHostalRoutes = require('./routes/JainHostal/jainHostalRoutes');
const jainFoodRoutes = require('./routes/JainFood/jainFoodRoutes');
const reportRoutes = require('./routes/SocialMediaRoutes/reportRoutes');
const blockRoutes = require('./routes/Block User/blockRoutes');
const deleteAccountRoutes = require('./routes/Account delete/deleteAccountRoutes');
const projectRoutes = require('./routes/SanghRoutes/projectRoutes');
const activityRoute = require('./routes/Activities/activityRoutes');
const scholarshipRoute = require('./routes/Scholarship/scholarshipRoutes');
//const appVersionRoute = require('./routes/Update apk/appVersion');

app.set('trust proxy',1);
// connect to databse
dbConnect();
app.use(helmet());
// Middleware
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true
}));

app.use(logMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:false}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve app-version.json as static file
app.use('/app-version', express.static(path.join(__dirname, 'app-version.json')));
// Session configuration for payment flow
app.use(session({
  secret: process.env.SESSION_SECRET || 'jainprabhutmanch-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.get('/', (req, res) => {
  res.send('Hello World!');
});
//app.use('/static', express.static('./Public/latest.apk'));
// Routes
app.use("/api/user",authRouter)
// Protected routes (require authentication)
//app.use('/api/app', appVersionRoute);
app.use("/api/JainAadhar", jainAdharRouter);
app.use("/api/friendship", authMiddleware, friendshipRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/notification', authMiddleware, notificationRoutes);
app.use('/api/messages', authMiddleware, messageRoutes);
app.use('/api/group', authMiddleware, groupChatRoutes);
app.use('/api/contact-us', contactUsRoutes);
// app.use('/api/units', authMiddleware, unitRoutes );
//app.use('/api/panchayat',panchayatRoute );

// Admin protected routes
app.use('/api/tirthsanrakshan', tirthSanrakshanRoute);
app.use('/api/Shanghatan', ShanghatanIdPasswordRoute);
app.use('/api/panchayat', panchayatIdPasswordRoutes);
app.use('/api/tirth', tirthIdPasswordRoutes);
app.use('/api/jainvyapar', jainVyaparRoute);
app.use('/api/biodata', biodataRoutes);
app.use("/api/rojgar", rojgarRoutes);
app.use('/api/reporting', reportingRoutes);
app.use('/api/suggestion-complaint', suggestionComplaintRoutes);
app.use("/api/granth", granthRoutes);
app.use("/api/jainitihas", jainItihasRoutes);
app.use('/api/yojana', govtYojanaRoutes);

// JainVyapar routes
app.use("/api/vyapar", vyaparRoutes);
app.use("/api/vyapar/posts", vyaparPostRoutes);

// Tirth routes
app.use('/api/tirth', authMiddleware, tirthRoutes);
app.use('/api/tirth/posts', tirthPostRoutes);

// Sadhu routes
app.use('/api/sadhu', sadhuRoutes);
app.use('/api/sadhu/posts', sadhuPostRoutes);

// Sangh Routes
app.use('/api/sangh-payment', paymentRoute);
app.use('/api/hierarchical-sangh', authMiddleware, hierarchicalSanghRoutes);
app.use('/api/sangh-access', authMiddleware, sanghAccessRoutes);
app.use('/api/sangh-posts', authMiddleware, sanghPostRoutes);
app.use('/api/panch', authMiddleware, panchayatRoutes);
app.use('/api/panch-posts', authMiddleware, panchPostRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/inqury', inquiryRoutes);
app.use('/api', projectRoutes);
// uplaod biolers
app.use('/api/bailors', bailorRoutes);

// Activity Api
app.use('/api/activity', activityRoute);
// Scholarship Api
app.use('/api/scholarship', scholarshipRoute);
// Jain Prathibha
app.use('/api/jainpratibha', jainPratibhaRoutes);
// jain Hostel
app.use('/api/jainhostal', jainHostalRoutes);
// jain Food
app.use('/api/jainFood', jainFoodRoutes);
// Foundation Payment
app.use('/api/payment', foundationPaymentRoutes);
// report
app.use('/api/report', reportRoutes);
// block user
app.use('/api/block', blockRoutes);
// Admin API routes
app.use("/api/admin", adminRouter);
app.use('/api', deleteAccountRoutes);
// Error handling
app.use(notFound);
app.use(errorHandler);
const server = http.createServer(app);
// ✅ Initialize WebSocket (⚠️ ye line missing thi)
initializeWebSocket(server);

// Start the job scheduler
scheduleStoryCleanup();

server.listen(PORT, () => {
    console.log(`✅ Server (HTTP + WebSocket) running on port ${PORT}`);

});

// // Function to delete expired stories every hour
// const deleteExpiredStories = async () => {
//     try {
//         const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
//         const result = await Story.deleteMany({ createdAt: { $lt: expiredTime } });
//         console.log(`Deleted ${result.deletedCount} expired stories`);
//     } catch (error) {
//         console.error("Error deleting expired stories:", error);
//     }
//   };
//   // Run the cleanup job every hour
//   setInterval(deleteExpiredStories, 60 * 60 * 1000);