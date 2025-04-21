
// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "getTranscript") {
    getYouTubeTranscript()
      .then(transcript => {
        sendResponse({ transcript: transcript });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    
    return true; // Return true to indicate that the response will be sent asynchronously
  }
});

// Function to get the YouTube video transcript
async function getYouTubeTranscript() {
  try {
    // Check if we're on a YouTube video page
    if (!window.location.href.includes('youtube.com/watch')) {
      throw new Error('Not a YouTube video page');
    }
    
    // Get video ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    
    if (!videoId) {
      throw new Error('Could not find video ID');
    }
    
    // First approach: Try to get transcript from YouTube's API
    try {
      const response = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`);
      const data = await response.text();
      
      if (data && data.length > 0 && data.includes('<text')) {
        return parseYouTubeTimedText(data);
      }
    } catch (e) {
      console.log('Failed to get transcript from YouTube API, trying alternative methods...');
    }
    
    // Second approach: Try to extract from the page DOM
    const transcript = await extractTranscriptFromDOM();
    if (transcript) {
      return transcript;
    }
    
    // Third approach: Use the YouTube transcript button if available
    const buttonTranscript = await getTranscriptViaButton();
    if (buttonTranscript) {
      return buttonTranscript;
    }
    
    throw new Error('Could not extract transcript using any available method');
  } catch (error) {
    console.error('Error getting YouTube transcript:', error);
    throw error;
  }
}

// Function to parse YouTube's timed text XML format
function parseYouTubeTimedText(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  const textElements = xmlDoc.getElementsByTagName('text');
  
  let fullTranscript = '';
  
  for (let i = 0; i < textElements.length; i++) {
    const textContent = textElements[i].textContent;
    if (textContent) {
      fullTranscript += textContent + ' ';
    }
  }
  
  return fullTranscript.trim();
}

// Function to extract transcript from DOM
async function extractTranscriptFromDOM() {
  // First look for the transcript panel if it's open
  const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer');
  
  if (transcriptItems && transcriptItems.length > 0) {
    let transcript = '';
    transcriptItems.forEach(item => {
      const textElement = item.querySelector('#text');
      if (textElement) {
        transcript += textElement.textContent + ' ';
      }
    });
    
    if (transcript) {
      return transcript.trim();
    }
  }
  
  // If transcript panel isn't open or available, try to find caption tracks in video player
  const videoElement = document.querySelector('video');
  if (videoElement && videoElement.textTracks && videoElement.textTracks.length > 0) {
    for (let i = 0; i < videoElement.textTracks.length; i++) {
      const track = videoElement.textTracks[i];
      
      // Prefer English tracks
      if (track.language === 'en' || track.label.toLowerCase().includes('english')) {
        track.mode = 'showing';
        
        // Wait for cues to load
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (track.cues && track.cues.length > 0) {
          let transcript = '';
          for (let j = 0; j < track.cues.length; j++) {
            transcript += track.cues[j].text + ' ';
          }
          return transcript.trim();
        }
      }
    }
  }
  
  return null;
}

// Function to get transcript by clicking the transcript button
async function getTranscriptViaButton() {
  // Try to find and click the transcript button
  const buttons = Array.from(document.querySelectorAll('button'));
  const transcriptButton = buttons.find(button => 
    button.textContent.toLowerCase().includes('transcript') || 
    button.getAttribute('aria-label')?.toLowerCase().includes('transcript')
  );
  
  if (transcriptButton) {
    // Click the transcript button
    transcriptButton.click();
    
    // Wait for transcript panel to open
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Now try to extract the transcript
    const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer');
    
    if (transcriptItems && transcriptItems.length > 0) {
      let transcript = '';
      transcriptItems.forEach(item => {
        const textElement = item.querySelector('#text');
        if (textElement) {
          transcript += textElement.textContent + ' ';
        }
      });
      
      if (transcript) {
        return transcript.trim();
      }
    }
    
    // Check for other transcript formats in the page
    const transcriptTexts = document.querySelectorAll('.segment-text');
    if (transcriptTexts && transcriptTexts.length > 0) {
      let transcript = '';
      transcriptTexts.forEach(item => {
        transcript += item.textContent + ' ';
      });
      
      if (transcript) {
        return transcript.trim();
      }
    }
  }
  
  return null;
}
