"use client"

// ... imports remain the same ...
// ... LocationAutocomplete helper remains the same ...

// UPDATE the AnalysisResults component's Report Summary PDF generation:

// ... inside handleDownloadSummaryReport ...
    // 1. BRAKE TESTS SECTION
    doc.setFontSize(12); doc.setTextColor(0); doc.text("1. Brake Test Results", 14, yPos + 10);
    yPos += 14;
    
    if (data.summary.brake_tests.length === 0) {
        doc.setFontSize(10); doc.setTextColor(100); doc.text("No Brake Tests recorded.", 14, yPos); yPos += 10;
    } else {
        autoTable(doc, {
            startY: yPos,
            // UPDATED HEADERS
            head: [["Test Type", "Start Speed", "End Speed", "Drop", "Status", "Location", "Time"]],
            body: data.summary.brake_tests.map(t => [
                t.type, 
                `${t.startSpeed} km/h`, 
                `${t.lowestSpeed} km/h`, 
                `${t.dropAmount} km/h`,
                t.status.toUpperCase().replace('_', ' '),
                t.location, 
                t.timestamp?.split(' ')[1]
            ]),
            theme: 'grid', headStyles: { fillColor: [71, 85, 105] }, styles: { fontSize: 9 },
            didParseCell: function(data) {
                if(data.column.index === 4 && data.section === 'body') {
                    const status = data.cell.raw as string;
                    if(status.includes('PROPER')) data.cell.styles.textColor = [22, 163, 74];
                    else if(status.includes('NOT')) data.cell.styles.textColor = [100, 116, 139];
                    else data.cell.styles.textColor = [220, 38, 38];
                    data.cell.styles.fontStyle = 'bold';
                }
            }
        });
        yPos = (doc as any).lastAutoTable.finalY + 10;
    }
// ... rest of the function remains the same ...
