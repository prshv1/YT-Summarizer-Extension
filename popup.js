
document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyButton = document.getElementById('saveApiKey');
  const apiStatus = document.getElementById('apiStatus');
  const videoInfo = document.getElementById('videoInfo');
  const summaryContent = document.getElementById('summaryContent');
  const summary = document.getElementById('summary');
  const loader = document.getElementById('loader');
  const getSummaryButton = document.getElementById('getSummary');
  const copySummaryButton = document.getElementById('copySummary');
  const saveSummaryButton = document.getElementById('saveSummary');
  
  // Load API key from storage
  chrome.storage.local.get(['togetherApiKey'], function(result) {
    if (result.togetherApiKey) {
      apiKeyInput.value = result.togetherApiKey;
      apiStatus.textContent = 'API key is saved';
      apiStatus.className = 'api-status success';
    }
  });

  // Save API key
  saveApiKeyButton.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      apiStatus.textContent = 'Please enter a valid API key';
      apiStatus.className = 'api-status error';
      return;
    }
    
    chrome.storage.local.set({ togetherApiKey: apiKey }, function() {
      apiStatus.textContent = 'API key saved successfully';
      apiStatus.className = 'api-status success';
    });
  });

  // Function to get current tab
  async function getCurrentTab() {
    let queryOptions = { active: true, currentWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
  }

  // Function to check if URL is a YouTube video
  function isYouTubeVideo(url) {
    return url && url.includes('youtube.com/watch');
  }

  // Function to extract video ID from YouTube URL
  function getVideoId(url) {
    const urlParams = new URLSearchParams(new URL(url).search);
    return urlParams.get('v');
  }

  // Function to get video transcript
  async function getTranscript(videoId) {
    // Execute a script in the tab to get the transcript
    const tab = await getCurrentTab();
    
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: fetchTranscriptFromPage,
      }, (results) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else if (results && results[0] && results[0].result) {
          resolve(results[0].result);
        } else {
          reject('Could not retrieve transcript');
        }
      });
    });
  }

  // Function to summarize transcript using Together.ai API
  async function summarizeTranscript(transcript, apiKey) {
    try {
      const response = await fetch('https://api.together.xyz/v1/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
          prompt: `Please provide a concise summary of the following YouTube video transcript. If the transcript is not in English, please translate the main points into English first, then summarize. Focus on the main points, key insights, and important details. Format the summary in clear paragraphs with appropriate spacing.\n\nTranscript:\n${transcript}\n\nSummary:`,
          max_tokens: 1000,
          temperature: 0.7,
          top_p: 0.9
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return data.choices[0].text.trim();
    } catch (error) {
      console.error("Error in API call:", error);
      throw error;
    }
  }

  // Copy summary to clipboard
  copySummaryButton.addEventListener('click', function() {
    const summaryText = summary.textContent || summary.innerText;
    if (!summaryText) {
      alert('No summary to copy');
      return;
    }
    
    navigator.clipboard.writeText(summaryText)
      .then(() => {
        const originalText = copySummaryButton.textContent;
        copySummaryButton.textContent = 'Copied!';
        setTimeout(() => {
          copySummaryButton.textContent = originalText;
        }, 2000);
      })
      .catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy summary');
      });
  });

  // Save summary as text file
  saveSummaryButton.addEventListener('click', function() {
    const summaryText = summary.textContent || summary.innerText;
    if (!summaryText) {
      alert('No summary to save');
      return;
    }
    
    const tab = getCurrentTab();
    let filename = 'youtube-summary.txt';
    
    // Try to get video title for better filename
    tab.then(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: getVideoTitle,
      }, (results) => {
        if (results && results[0] && results[0].result) {
          // Clean the title to use as a filename
          filename = results[0].result.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 50) + '-summary.txt';
        }
        downloadTextFile(summaryText, filename);
      });
    });
  });

  function getVideoTitle() {
    const title = document.querySelector('h1.ytd-watch-metadata')?.textContent || 
                  document.querySelector('h1.title')?.textContent || 
                  'youtube-video';
    return title.trim();
  }

  function downloadTextFile(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // Handle get summary button click
  getSummaryButton.addEventListener('click', async function() {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      apiStatus.textContent = 'Please enter your Together.ai API key';
      apiStatus.className = 'api-status error';
      return;
    }
    
    // Show loader
    summary.textContent = '';
    loader.style.display = 'block';
    getSummaryButton.disabled = true;
    
    try {
      const tab = await getCurrentTab();
      
      if (!isYouTubeVideo(tab.url)) {
        throw new Error('Not a YouTube video page');
      }
      
      const videoId = getVideoId(tab.url);
      
      // Update video info
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: getVideoInfo,
      }, (results) => {
        if (results && results[0] && results[0].result) {
          const info = results[0].result;
          videoInfo.innerHTML = `
            <strong>${info.title}</strong><br>
            Channel: ${info.channelName}<br>
            Length: ${info.duration}
          `;
        }
      });
      
      // Get transcript
      const transcript = await getTranscript(videoId);
      
      // Get summary
      const summarizedText = await summarizeTranscript(transcript, apiKey);
      
      // Display summary
      summary.innerHTML = summarizedText.replace(/\n/g, '<br>');

      // Show copy and save buttons
      copySummaryButton.style.display = 'inline-block';
      saveSummaryButton.style.display = 'inline-block';
    } catch (error) {
      summary.textContent = `Error: ${error.message || 'Failed to summarize video'}`;
    } finally {
      loader.style.display = 'none';
      getSummaryButton.disabled = false;
    }
  });
});

// Function to be injected into the page to get video info
function getVideoInfo() {
  const title = document.querySelector('h1.ytd-watch-metadata')?.textContent || 'Unknown Title';
  const channelName = document.querySelector('#channel-name a')?.textContent || 'Unknown Channel';
  const durationElement = document.querySelector('.ytp-time-duration');
  const duration = durationElement ? durationElement.textContent : 'Unknown';
  
  return {
    title,
    channelName,
    duration
  };
}

// Function to be injected into the page to fetch the transcript
function fetchTranscriptFromPage() {
  // Helper to wait for element
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const element = document.querySelector(selector);
        if (element) {
          clearInterval(interval);
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for ${selector}`));
        }
      }, 100);
    });
  }

  // Find and click the transcript button
  async function openTranscriptPanel() {
    // First attempt: Look for the standard "Show transcript" button
    const buttons = Array.from(document.querySelectorAll('button'));
    let transcriptButton = buttons.find(button => 
      button.textContent.toLowerCase().includes('show transcript') ||
      button.textContent.toLowerCase().includes('open transcript')
    );
    
    // Second attempt: Look in the menu items
    if (!transcriptButton) {
      const menuItems = Array.from(document.querySelectorAll('tp-yt-paper-item, ytd-menu-service-item-renderer'));
      transcriptButton = menuItems.find(item => 
        item.textContent.toLowerCase().includes('show transcript') ||
        item.textContent.toLowerCase().includes('open transcript')
      );
    }
    
    if (!transcriptButton) {
      // Try opening more actions menu first
      const moreActionsBtn = document.querySelector('button[aria-label="More actions"]');
      if (moreActionsBtn) {
        moreActionsBtn.click();
        await new Promise(r => setTimeout(r, 500));
        
        // Now look again for transcript option
        const menuItems = Array.from(document.querySelectorAll('tp-yt-paper-item, ytd-menu-service-item-renderer'));
        transcriptButton = menuItems.find(item => 
          item.textContent.toLowerCase().includes('show transcript') ||
          item.textContent.toLowerCase().includes('open transcript')
        );
      }
    }
    
    if (!transcriptButton) {
      throw new Error("Transcript button not found");
    }
    
    transcriptButton.click();
    await new Promise(r => setTimeout(r, 1000));
  }

  // Attempt to select English transcript if available
  async function selectEnglishTranscript() {
    try {
      // Try to find the button that opens language selection
      const settingsButton = document.querySelector('button[aria-label="Transcript settings"]') || 
                            document.querySelector('ytd-transcript-settings-button-renderer button');
      
      if (settingsButton) {
        settingsButton.click();
        await new Promise(r => setTimeout(r, 500));
        
        // Look for English in the dropdown
        const menuItems = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer'));
        
        // First priority: "English" option
        let englishOption = menuItems.find(item => 
          item.textContent.trim().toLowerCase() === 'english'
        );
        
        // Second priority: Any option with "English" in it
        if (!englishOption) {
          englishOption = menuItems.find(item => 
            item.textContent.toLowerCase().includes('english')
          );
        }
        
        // Third priority: Any option with "translate" in it
        if (!englishOption) {
          const translateOption = menuItems.find(item => 
            item.textContent.toLowerCase().includes('translate')
          );
          
          if (translateOption) {
            translateOption.click();
            await new Promise(r => setTimeout(r, 500));
            
            // Now look for English in the second-level menu
            const subMenuItems = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer'));
            englishOption = subMenuItems.find(item => 
              item.textContent.toLowerCase().includes('english')
            );
          }
        }
        
        if (englishOption) {
          englishOption.click();
          await new Promise(r => setTimeout(r, 1000)); // Wait for transcript to update
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Error selecting English transcript:', error);
      return false;
    }
  }

  // Extract text from transcript segments
  function extractTranscriptText() {
    // Modern YouTube transcript UI
    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    if (segments.length > 0) {
      return segments.map(segment => {
        const textElement = segment.querySelector('.segment-text');
        return textElement ? textElement.textContent.trim() : '';
      }).join(' ');
    }
    
    // Alternative selectors for different YouTube UI versions
    const alternativeSegments = Array.from(document.querySelectorAll('.ytd-transcript-segment-list-renderer .segment'));
    if (alternativeSegments.length > 0) {
      return alternativeSegments.map(segment => {
        const textElement = segment.querySelector('.segment-text');
        return textElement ? textElement.textContent.trim() : '';
      }).join(' ');
    }
    
    // Another alternative
    const textElements = document.querySelectorAll('yt-formatted-string.ytd-transcript-segment-renderer');
    if (textElements.length > 0) {
      return Array.from(textElements).map(el => el.textContent.trim()).join(' ');
    }
    
    throw new Error('Could not find transcript segments');
  }

  return new Promise(async (resolve, reject) => {
    try {
      // First check if transcript panel is already open
      let transcriptPanel = document.querySelector('ytd-transcript-renderer');
      
      if (!transcriptPanel) {
        await openTranscriptPanel();
        // Wait for transcript panel to appear
        transcriptPanel = await waitForElement('ytd-transcript-renderer', 3000)
          .catch(() => null);
        
        if (!transcriptPanel) {
          reject(new Error('Transcript panel did not open'));
          return;
        }
      }
      
      // Try to select English transcript
      await selectEnglishTranscript();
      
      // Extract transcript text
      const transcriptText = extractTranscriptText();
      resolve(transcriptText);
      
    } catch (error) {
      reject(error.toString());
    }
  });
}

