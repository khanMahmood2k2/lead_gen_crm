const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

// 1. Initialize Database & RSS Parser
const serviceAccount = require("./serviceAccountKey.json");
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const parser = new Parser();

// 2. Initialize Gemini 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getRemoteJobs() {
    console.log("Fetching programming jobs from WeWorkRemotely RSS...\n");
    
    // WeWorkRemotely's public, legal RSS feed for programming jobs
    const feedUrl = 'https://weworkremotely.com/categories/remote-programming-jobs.rss';

    try {
        const feed = await parser.parseURL(feedUrl);
        
        // Filter for jobs that mention Flutter or Mobile
        const flutterJobs = feed.items.filter(job => 
            job.title.toLowerCase().includes('flutter') || 
            job.title.toLowerCase().includes('mobile') ||
            job.title.toLowerCase().includes('app')
        );

        if (flutterJobs.length === 0) {
            console.log("No Flutter/Mobile jobs found on the RSS feed right now. Injecting a test lead...");
            flutterJobs.push({
                title: "Senior Flutter Developer (Remote)",
                contentSnippet: "We are looking for a senior mobile engineer to lead our Flutter migration. Must have experience with Firebase and state management.",
                link: "https://weworkremotely.com/test-job",
                creator: "TechStartup Inc."
            });
        }

        const job = flutterJobs[0];
        console.log(`🔥 Analyzing Job: ${job.title}\n`);

        const prompt = `
            You are a lead qualification bot. Analyze this job posting:
            Title: "${job.title}"
            Description: "${job.contentSnippet.substring(0, 500)}"
            
            Is this client looking for mobile/Flutter development help? 
            If YES, write a short, professional outreach message offering your freelance services. 
            Format ONLY as valid JSON: {"is_lead": true, "dm": "message"}
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
        const result = await model.generateContent(prompt);
        
        const rawText = result.response.text();
        const cleanJson = JSON.parse(rawText.replace(/```json|```/g, '').trim());

        console.log("✅ AI Verdict:");
        console.log(cleanJson);

        if (cleanJson.is_lead) {
            console.log("\n💾 Saving RSS lead to Firestore...");
            
            const newLead = {
                lead_id: `wwr_${Date.now()}`, 
                source_platform: "WeWorkRemotely",
                author_username: job.creator || "Unknown Company",
                original_url: job.link,
                combined_text: `${job.title}\n${job.contentSnippet}`,
                ai_generated_dm: cleanJson.dm,
                status: "new",
                niche: "Flutter",
                timestamp: new Date().toISOString()
            };

            await db.collection('leads').doc(newLead.lead_id).set(newLead);
            console.log("🎉 RSS Lead successfully saved to database!");
        }

    } catch (error) {
        console.error("Failed:", error);
    }
}

getRemoteJobs();