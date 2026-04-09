const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

// 1. Initialize Firebase Database
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Initialize Gemini (Keep your key here!)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getLeadsAndFilter() {
  console.log("Fetching 'Hiring' posts from Reddit...\n");
  const targetUrl = 'https://www.reddit.com/r/forhire/search.json?q=flutter&restrict_sr=1&sort=new';

  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
    });

    const json = await response.json();
    let posts = json.data.children.filter(p => p.data.title.toLowerCase().includes('hiring'));

    if (posts.length === 0) {
      console.log("⚠️ No real [HIRING] posts found. Injecting mock lead...\n");
      posts = [{
         data: {
             id: "mock_lead_123", // Added a fake ID
             title: "[HIRING] Need a Flutter developer for a new habit tracking application",
             selftext: "We are looking for a mobile dev with Flutter and Firebase experience. Budget is $3000.",
             permalink: "/r/forhire/comments/mock"
         }
      }];
    }

    const post = posts[0].data;
    console.log(`🔥 Analyzing Post: ${post.title}\n`);

    const prompt = `
      You are a lead qualification bot. Analyze this post:
      Title: "${post.title}"
      Body: "${post.selftext.substring(0, 500)}"
      
      Is this person explicitly looking to hire a Flutter developer? 
      If YES, write a short, friendly DM. If NO, leave dm blank.
      Format ONLY as valid JSON: {"is_lead": true, "dm": "message"}
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    const result = await model.generateContent(prompt);
    
    const rawText = result.response.text();
    const cleanJson = JSON.parse(rawText.replace(/```json|```/g, '').trim());

    console.log("✅ AI Verdict:");
    console.log(cleanJson);

    // 3. Save to Firestore IF it's a valid lead
    if (cleanJson.is_lead) {
      console.log("\n💾 Saving lead to Firestore...");
      
      const newLead = {
        lead_id: post.id,
        source_platform: "Reddit",
        author_username: post.author || "Unknown",
        original_url: `https://reddit.com${post.permalink}`,
        combined_text: `${post.title}\n${post.selftext}`,
        ai_generated_dm: cleanJson.dm,
        status: "new",
        niche: "Flutter",
        timestamp: new Date().toISOString()
      };

      // Save it using the post ID so we don't save duplicates!
      await db.collection('leads').doc(newLead.lead_id).set(newLead);
      console.log("🎉 Lead successfully saved to database!");
    }

  } catch (error) {
    console.error("Failed:", error);
  }
}

getLeadsAndFilter();