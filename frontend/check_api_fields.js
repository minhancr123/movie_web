
const axios = require('axios');
const API_URL = 'http://localhost:5291/api/movies';

async function checkData() {
  try {
    const response = await axios.get(`${API_URL}?page=1`);
    const movies = response.data.items || [];
    if (movies.length > 0) {
      console.log("Keys available in movie object:", Object.keys(movies[0]));
      // Check for content/description
      if (movies[0].content) console.log("Has content field");
      else console.log("No content field");
    }
  } catch (error) {
    console.error("Error fetching:", error.message);
  }
}

checkData();
