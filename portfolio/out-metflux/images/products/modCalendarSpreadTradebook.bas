
Attribute VB_Name = "modCalendarSpreadTradebook"
Option Explicit

'========================
' USER SETTINGS
'========================
Private Const RAW_SHEET As String = "Sheet1"
Private Const FNO_SHEET As String = "F&O STATEMENT"
Private Const STRIKE_SHEET As String = "STRIKE PRICE TABLE"
Private Const CHARGES_SHEET As String = "CS CHARGES"

Private Const BROKERAGE_PER_ORDER As Double = 20
Private Const LOT_SIZE_DEFAULT As Long = 65

'Charges assumptions. Change these if your broker/rate card is different.
Private Const STT_RATE As Double = 0.000625          'Options STT on sell premium
Private Const EXCHANGE_TXN_RATE As Double = 0.0003553
Private Const SEBI_RATE As Double = 0.000001
Private Const GST_RATE As Double = 0.18             'On brokerage + exchange + SEBI + IPFT + CM charges
Private Const NSE_IPFT_RATE As Double = 0.000001
Private Const STAMP_DUTY_RATE As Double = 0.00003   'On buy premium
Private Const CM_CHARGE_RATE As Double = 0.00009

'========================
' MAIN MACRO
'========================
Public Sub BuildCalendarSpreadAnalysis()
    Dim filePath As Variant
    Dim srcWb As Workbook, srcWs As Worksheet
    Dim rawWs As Worksheet, fnoWs As Worksheet, strikeWs As Worksheet, chargesWs As Worksheet
    Dim oldCalc As XlCalculation

    On Error GoTo CleanFail

    oldCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    Application.Calculation = xlCalculationManual

    filePath = Application.GetOpenFilename( _
        FileFilter:="Excel Files (*.xlsx;*.xls;*.xlsm;*.csv),*.xlsx;*.xls;*.xlsm;*.csv", _
        Title:="Select Broker Tradebook File")

    If VarType(filePath) = vbBoolean Then GoTo CleanExit

    Set rawWs = GetOrCreateSheet(RAW_SHEET)
    Set fnoWs = GetOrCreateSheet(FNO_SHEET)
    Set strikeWs = GetOrCreateSheet(STRIKE_SHEET)
    Set chargesWs = GetOrCreateSheet(CHARGES_SHEET)

    rawWs.Cells.Clear
    fnoWs.Cells.Clear
    strikeWs.Cells.Clear
    chargesWs.Cells.Clear

    Set srcWb = Workbooks.Open(CStr(filePath), ReadOnly:=True)
    Set srcWs = srcWb.Worksheets(1)

    srcWs.UsedRange.Copy Destination:=rawWs.Range("A1")
    srcWb.Close SaveChanges:=False

    BuildFNOStatement rawWs, fnoWs
    BuildStrikePriceTable fnoWs, strikeWs
    BuildCSChargesTable strikeWs, chargesWs

    FormatAll rawWs, fnoWs, strikeWs, chargesWs

    Application.Calculation = oldCalc
    Application.CalculateFull

    MsgBox "Done. Tradebook imported and F&O Statement, Strike Price Table, and CS Charges created.", vbInformation

CleanExit:
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    Application.Calculation = oldCalc
    Exit Sub

CleanFail:
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    Application.Calculation = oldCalc
    MsgBox "Error: " & Err.Description, vbCritical
End Sub

'========================
' BUILD F&O STATEMENT
'========================
Private Sub BuildFNOStatement(ByVal rawWs As Worksheet, ByVal outWs As Worksheet)
    Dim hdrRow As Long, lastRow As Long, outRow As Long, r As Long
    Dim cSymbol As Long, cISIN As Long, cTradeDate As Long, cExchange As Long, cSegment As Long
    Dim cSeries As Long, cTradeType As Long, cAuction As Long, cQty As Long, cPrice As Long
    Dim cTradeID As Long, cOrderID As Long, cOrderTime As Long, cExpiry As Long
    Dim sym As String, tType As String, expDate As Variant, price As Double, qty As Double
    Dim minExp As Date

    hdrRow = FindHeaderRow(rawWs, "Symbol")
    If hdrRow = 0 Then Err.Raise vbObjectError + 101, , "Could not find tradebook header row containing 'Symbol'."

    cSymbol = FindHeaderCol(rawWs, hdrRow, "Symbol")
    cISIN = FindHeaderCol(rawWs, hdrRow, "ISIN")
    cTradeDate = FindHeaderCol(rawWs, hdrRow, "Trade Date")
    cExchange = FindHeaderCol(rawWs, hdrRow, "Exchange")
    cSegment = FindHeaderCol(rawWs, hdrRow, "Segment")
    cSeries = FindHeaderCol(rawWs, hdrRow, "Series")
    cTradeType = FindHeaderCol(rawWs, hdrRow, "Trade Type")
    cAuction = FindHeaderCol(rawWs, hdrRow, "Auction")
    cQty = FindHeaderCol(rawWs, hdrRow, "Quantity")
    cPrice = FindHeaderCol(rawWs, hdrRow, "Price")
    cTradeID = FindHeaderCol(rawWs, hdrRow, "Trade ID")
    cOrderID = FindHeaderCol(rawWs, hdrRow, "Order ID")
    cOrderTime = FindHeaderCol(rawWs, hdrRow, "Order Execution Time")
    cExpiry = FindHeaderCol(rawWs, hdrRow, "Expiry Date")
    If cExpiry = 0 Then cExpiry = GuessExpiryCol(rawWs, hdrRow, cOrderTime)

    If cSymbol * cTradeType * cQty * cPrice = 0 Then
        Err.Raise vbObjectError + 102, , "Missing one or more required headers: Symbol, Trade Type, Quantity, Price."
    End If

    lastRow = rawWs.Cells(rawWs.Rows.Count, cSymbol).End(xlUp).Row

    outWs.Range("A1:V1").Value = Array("S.NO.", "Symbol", "INSTRUMENT", "STRIKE PRICE", "EXPIRY DATE", "EXPIRY", _
        "ISIN", "Trade Date", "Exchange", "Segment", "Series", "Trade Type", "Auction", "Quantity", _
        "PRICE -1", "VALUE", "Price", "Trade ID", "Order ID", "Order Execution Time", "REF NO.", "STATUS")

    outRow = 2
    minExp = DateSerial(2099, 12, 31)

    For r = hdrRow + 1 To lastRow
        sym = Trim(CStr(rawWs.Cells(r, cSymbol).Value))
        If Len(sym) > 0 Then
            expDate = Empty
            If cExpiry > 0 Then expDate = rawWs.Cells(r, cExpiry).Value
            If Not IsDate(expDate) Then expDate = ParseExpiryDateFromSymbol(sym)
            If IsDate(expDate) Then
                If CDate(expDate) < minExp Then minExp = CDate(expDate)
            End If
        End If
    Next r

    For r = hdrRow + 1 To lastRow
        sym = Trim(CStr(rawWs.Cells(r, cSymbol).Value))
        If Len(sym) > 0 Then
            tType = LCase$(Trim(CStr(rawWs.Cells(r, cTradeType).Value)))
            qty = Val(rawWs.Cells(r, cQty).Value)
            price = Val(rawWs.Cells(r, cPrice).Value)
            expDate = Empty
            If cExpiry > 0 Then expDate = rawWs.Cells(r, cExpiry).Value
            If Not IsDate(expDate) Then expDate = ParseExpiryDateFromSymbol(sym)

            outWs.Cells(outRow, 1).Value = outRow - 1
            outWs.Cells(outRow, 2).Value = sym
            outWs.Cells(outRow, 3).Value = ExtractInstrument(sym)
            outWs.Cells(outRow, 4).Value = ExtractStrike(sym)
            If IsDate(expDate) Then outWs.Cells(outRow, 5).Value = CDate(expDate)
            If IsDate(expDate) Then
                If CDate(expDate) = minExp Then
                    outWs.Cells(outRow, 6).Value = "CURRENT"
                Else
                    outWs.Cells(outRow, 6).Value = "NEXT"
                End If
            End If

            If cISIN > 0 Then outWs.Cells(outRow, 7).Value = rawWs.Cells(r, cISIN).Value
            If cTradeDate > 0 Then outWs.Cells(outRow, 8).Value = rawWs.Cells(r, cTradeDate).Value
            If cExchange > 0 Then outWs.Cells(outRow, 9).Value = rawWs.Cells(r, cExchange).Value
            If cSegment > 0 Then outWs.Cells(outRow, 10).Value = rawWs.Cells(r, cSegment).Value
            If cSeries > 0 Then outWs.Cells(outRow, 11).Value = rawWs.Cells(r, cSeries).Value
            outWs.Cells(outRow, 12).Value = tType
            If cAuction > 0 Then outWs.Cells(outRow, 13).Value = rawWs.Cells(r, cAuction).Value
            outWs.Cells(outRow, 14).Value = qty
            outWs.Cells(outRow, 15).Value = IIf(tType = "sell", -price, price)
            outWs.Cells(outRow, 16).FormulaR1C1 = "=RC[-2]*RC[-1]"
            outWs.Cells(outRow, 17).Value = price
            If cTradeID > 0 Then outWs.Cells(outRow, 18).Value = rawWs.Cells(r, cTradeID).Value
            If cOrderID > 0 Then outWs.Cells(outRow, 19).Value = rawWs.Cells(r, cOrderID).Value
            If cOrderTime > 0 Then outWs.Cells(outRow, 20).Value = rawWs.Cells(r, cOrderTime).Value
            outWs.Cells(outRow, 21).Value = vbNullString
            outWs.Cells(outRow, 22).FormulaR1C1 = "=IF(SUMIFS(C14,C2,RC2,C12,""buy"")=SUMIFS(C14,C2,RC2,C12,""sell""),""CLOSED"",""OPEN"")"
            outRow = outRow + 1
        End If
    Next r

    If outRow > 2 Then
        outWs.Range("A1:V" & outRow - 1).AutoFilter
        outWs.Columns("E:E").NumberFormat = "yyyy-mm-dd"
        outWs.Columns("H:H").NumberFormat = "yyyy-mm-dd"
        outWs.Columns("O:Q").NumberFormat = "0.00"
    End If
End Sub

'========================
' BUILD STRIKE PRICE TABLE
'========================
Private Sub BuildStrikePriceTable(ByVal fnoWs As Worksheet, ByVal outWs As Worksheet)
    Dim lastRow As Long, r As Long, outRow As Long
    Dim dict As Object, key As Variant, parts As Variant
    Dim strike As String, inst As String, expType As String, tradeType As String
    Dim qty As Double, price As Double, val As Double

    Set dict = CreateObject("Scripting.Dictionary")
    lastRow = fnoWs.Cells(fnoWs.Rows.Count, "B").End(xlUp).Row

    For r = 2 To lastRow
        strike = CStr(fnoWs.Cells(r, 4).Value)
        inst = CStr(fnoWs.Cells(r, 3).Value)
        expType = UCase$(CStr(fnoWs.Cells(r, 6).Value))
        tradeType = LCase$(CStr(fnoWs.Cells(r, 12).Value))
        key = strike & "|" & inst

        If Len(strike) > 0 And Len(inst) > 0 Then
            If Not dict.Exists(key) Then
                '0 strike, 1 instrument, 2 currBuyQty, 3 currBuyVal, 4 currSellQty, 5 currSellVal,
                '6 nextBuyQty, 7 nextBuyVal, 8 nextSellQty, 9 nextSellVal, 10 currExp, 11 nextExp
                dict.Add key, Array(strike, inst, 0#, 0#, 0#, 0#, 0#, 0#, 0#, 0#, vbNullString, vbNullString)
            End If

            parts = dict(key)
            qty = Val(fnoWs.Cells(r, 14).Value)
            price = Val(fnoWs.Cells(r, 17).Value)
            val = qty * price

            If expType = "CURRENT" Then
                parts(10) = fnoWs.Cells(r, 5).Value
                If tradeType = "buy" Then
                    parts(2) = parts(2) + qty
                    parts(3) = parts(3) + val
                ElseIf tradeType = "sell" Then
                    parts(4) = parts(4) + qty
                    parts(5) = parts(5) + val
                End If
            ElseIf expType = "NEXT" Then
                parts(11) = fnoWs.Cells(r, 5).Value
                If tradeType = "buy" Then
                    parts(6) = parts(6) + qty
                    parts(7) = parts(7) + val
                ElseIf tradeType = "sell" Then
                    parts(8) = parts(8) + qty
                    parts(9) = parts(9) + val
                End If
            End If
            dict(key) = parts
        End If
    Next r

    outWs.Range("A1:Q1").Value = Array("S.NO.", "Strike Price", "Instrument", "Current Expiry", "Current Buy Qty", "Current Buy Avg", _
        "Current Sell Qty", "Current Sell Avg", "Next Expiry", "Next Buy Qty", "Next Buy Avg", "Next Sell Qty", "Next Sell Avg", _
        "Net Qty", "Spread Type", "Turnover", "Gross P&L")

    outRow = 2
    For Each key In dict.Keys
        parts = dict(key)
        outWs.Cells(outRow, 1).Value = outRow - 1
        outWs.Cells(outRow, 2).Value = parts(0)
        outWs.Cells(outRow, 3).Value = parts(1)
        outWs.Cells(outRow, 4).Value = parts(10)
        outWs.Cells(outRow, 5).Value = parts(2)
        If parts(2) <> 0 Then outWs.Cells(outRow, 6).Value = parts(3) / parts(2)
        outWs.Cells(outRow, 7).Value = parts(4)
        If parts(4) <> 0 Then outWs.Cells(outRow, 8).Value = parts(5) / parts(4)
        outWs.Cells(outRow, 9).Value = parts(11)
        outWs.Cells(outRow, 10).Value = parts(6)
        If parts(6) <> 0 Then outWs.Cells(outRow, 11).Value = parts(7) / parts(6)
        outWs.Cells(outRow, 12).Value = parts(8)
        If parts(8) <> 0 Then outWs.Cells(outRow, 13).Value = parts(9) / parts(8)
        outWs.Cells(outRow, 14).FormulaR1C1 = "=(RC[-9]+RC[-5])-(RC[-7]+RC[-3])"
        outWs.Cells(outRow, 15).FormulaR1C1 = "=IF(AND(RC[-8]>0,RC[-5]>0),""SELL CURRENT / BUY NEXT"",IF(AND(RC[-10]>0,RC[-3]>0),""BUY CURRENT / SELL NEXT"",""CHECK""))"
        outWs.Cells(outRow, 16).FormulaR1C1 = "=SUMPRODUCT(RC[-11]:RC[-4],RC[-10]:RC[-3])"
        outWs.Cells(outRow, 17).FormulaR1C1 = "=(RC[-10]*RC[-9]+RC[-5]*RC[-4])-(RC[-12]*RC[-11]+RC[-7]*RC[-6])"
        outRow = outRow + 1
    Next key

    If outRow > 2 Then outWs.Range("A1:Q" & outRow - 1).AutoFilter
    outWs.Columns("D:D").NumberFormat = "yyyy-mm-dd"
    outWs.Columns("I:I").NumberFormat = "yyyy-mm-dd"
End Sub

'========================
' BUILD CS CHARGES TABLE
'========================
Private Sub BuildCSChargesTable(ByVal strikeWs As Worksheet, ByVal outWs As Worksheet)
    Dim lastRow As Long, outLast As Long

    lastRow = strikeWs.Cells(strikeWs.Rows.Count, "A").End(xlUp).Row

    outWs.Range("A1:S1").Value = Array("S.NO.", "Strike Price", "Instrument", "Spread Type", "Lots", "Lot Size", _
        "Gross P&L", "Turnover", "Sell Premium", "Buy Premium", "Brokerage", "STT", "Exchange Txn", _
        "SEBI", "NSE IPFT", "Stamp Duty", "CM Charges", "GST", "Total Charges")
    outWs.Range("T1").Value = "Net P&L"

    If lastRow < 2 Then Exit Sub

    outLast = lastRow

    outWs.Range("A2:A" & outLast).FormulaR1C1 = "=ROW()-1"
    outWs.Range("B2:B" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC"
    outWs.Range("C2:C" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC"
    outWs.Range("D2:D" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC[11]"
    outWs.Range("E2:E" & outLast).FormulaR1C1 = "=MAX(1,ROUNDUP(MAX('" & STRIKE_SHEET & "'!RC[2],'" & STRIKE_SHEET & "'!RC[5],'" & STRIKE_SHEET & "'!RC[8],'" & STRIKE_SHEET & "'!RC[11])/" & LOT_SIZE_DEFAULT & ",0))"
    outWs.Range("F2:F" & outLast).Value = LOT_SIZE_DEFAULT
    outWs.Range("G2:G" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC[10]"
    outWs.Range("H2:H" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC[8]"
    outWs.Range("I2:I" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC[-2]*'" & STRIKE_SHEET & "'!RC[-1]+'" & STRIKE_SHEET & "'!RC[3]*'" & STRIKE_SHEET & "'!RC[4]"
    outWs.Range("J2:J" & outLast).FormulaR1C1 = "='" & STRIKE_SHEET & "'!RC[-5]*'" & STRIKE_SHEET & "'!RC[-4]+'" & STRIKE_SHEET & "'!RC*'" & STRIKE_SHEET & "'!RC[1]"
    outWs.Range("K2:K" & outLast).FormulaR1C1 = "=" & BROKERAGE_PER_ORDER & "*COUNTIF('" & STRIKE_SHEET & "'!RC[-6]:RC[1],"">0"")"
    outWs.Range("L2:L" & outLast).FormulaR1C1 = "=RC[-3]*" & STT_RATE
    outWs.Range("M2:M" & outLast).FormulaR1C1 = "=RC[-5]*" & EXCHANGE_TXN_RATE
    outWs.Range("N2:N" & outLast).FormulaR1C1 = "=RC[-6]*" & SEBI_RATE
    outWs.Range("O2:O" & outLast).FormulaR1C1 = "=RC[-7]*" & NSE_IPFT_RATE
    outWs.Range("P2:P" & outLast).FormulaR1C1 = "=RC[-6]*" & STAMP_DUTY_RATE
    outWs.Range("Q2:Q" & outLast).FormulaR1C1 = "=RC[-9]*" & CM_CHARGE_RATE
    outWs.Range("R2:R" & outLast).FormulaR1C1 = "=(RC[-7]+RC[-5]+RC[-4]+RC[-3]+RC[-1])*" & GST_RATE
    outWs.Range("S2:S" & outLast).FormulaR1C1 = "=SUM(RC[-8]:RC[-1])"
    outWs.Range("T2:T" & outLast).FormulaR1C1 = "=RC[-13]-RC[-1]"

    outWs.Range("A" & outLast + 2).Value = "TOTAL"
    outWs.Range("G" & outLast + 2).Formula = "=SUM(G2:G" & outLast & ")"
    outWs.Range("S" & outLast + 2).Formula = "=SUM(S2:S" & outLast & ")"
    outWs.Range("T" & outLast + 2).Formula = "=SUM(T2:T" & outLast & ")"
    outWs.Range("A1:T" & outLast).AutoFilter
End Sub

'========================
' FORMATTING
'========================
Private Sub FormatAll(ByVal rawWs As Worksheet, ByVal fnoWs As Worksheet, ByVal strikeWs As Worksheet, ByVal chargesWs As Worksheet)
    FormatSheet rawWs, "Imported Broker Tradebook"
    FormatSheet fnoWs, "F&O Statement"
    FormatSheet strikeWs, "Strike Price Table"
    FormatSheet chargesWs, "CS Charges"
End Sub

Private Sub FormatSheet(ByVal ws As Worksheet, ByVal titleText As String)
    Dim lastCol As Long, lastRow As Long
    If Application.WorksheetFunction.CountA(ws.Cells) = 0 Then Exit Sub

    lastRow = ws.Cells.Find("*", , xlFormulas, , xlByRows, xlPrevious).Row
    lastCol = ws.Cells.Find("*", , xlFormulas, , xlByColumns, xlPrevious).Column

    With ws.Range(ws.Cells(1, 1), ws.Cells(1, lastCol))
        .Font.Bold = True
        .Interior.Color = RGB(31, 78, 121)
        .Font.Color = RGB(255, 255, 255)
    End With

    ws.Rows(1).RowHeight = 22
    ws.Columns.AutoFit
    ws.Range(ws.Cells(1, 1), ws.Cells(lastRow, lastCol)).Borders.LineStyle = xlContinuous
    ws.Range(ws.Cells(1, 1), ws.Cells(lastRow, lastCol)).Borders.Color = RGB(220, 220, 220)
    ws.Activate
    ws.Range("A2").Select
    ActiveWindow.FreezePanes = True

    On Error Resume Next
    ws.Columns("A:Z").ColumnWidth = 14
    ws.Columns("B:B").ColumnWidth = 22
    ws.Columns("T:T").ColumnWidth = 22
    On Error GoTo 0
End Sub

'========================
' HELPER FUNCTIONS
'========================
Private Function GetOrCreateSheet(ByVal sheetName As String) As Worksheet
    On Error Resume Next
    Set GetOrCreateSheet = ThisWorkbook.Worksheets(sheetName)
    On Error GoTo 0

    If GetOrCreateSheet Is Nothing Then
        Set GetOrCreateSheet = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        GetOrCreateSheet.Name = sheetName
    End If
End Function

Private Function FindHeaderRow(ByVal ws As Worksheet, ByVal headerText As String) As Long
    Dim f As Range
    Set f = ws.Cells.Find(What:=headerText, LookIn:=xlValues, LookAt:=xlWhole, MatchCase:=False)
    If Not f Is Nothing Then FindHeaderRow = f.Row
End Function

Private Function FindHeaderCol(ByVal ws As Worksheet, ByVal hdrRow As Long, ByVal headerText As String) As Long
    Dim f As Range
    Set f = ws.Rows(hdrRow).Find(What:=headerText, LookIn:=xlValues, LookAt:=xlWhole, MatchCase:=False)
    If Not f Is Nothing Then FindHeaderCol = f.Column
End Function

Private Function GuessExpiryCol(ByVal ws As Worksheet, ByVal hdrRow As Long, ByVal orderTimeCol As Long) As Long
    Dim c As Long, lastCol As Long, testVal As Variant
    If orderTimeCol = 0 Then Exit Function

    lastCol = ws.Cells(hdrRow + 1, ws.Columns.Count).End(xlToLeft).Column
    For c = orderTimeCol + 1 To lastCol
        testVal = ws.Cells(hdrRow + 1, c).Value
        If IsDate(testVal) Then
            GuessExpiryCol = c
            Exit Function
        End If
    Next c
End Function

Private Function ExtractInstrument(ByVal sym As String) As String
    sym = UCase$(Trim$(sym))
    If Len(sym) >= 2 Then ExtractInstrument = Right$(sym, 2)
End Function

Private Function ExtractStrike(ByVal sym As String) As Long
    Dim s As String, i As Long, digits As String
    s = UCase$(Trim$(sym))
    If Right$(s, 2) = "CE" Or Right$(s, 2) = "PE" Then s = Left$(s, Len(s) - 2)

    For i = Len(s) To 1 Step -1
        If Mid$(s, i, 1) Like "#" Then
            digits = Mid$(s, i, 1) & digits
        ElseIf Len(digits) > 0 Then
            Exit For
        End If
    Next i

    If Len(digits) > 0 Then ExtractStrike = CLng(digits)
End Function

Private Function ParseExpiryDateFromSymbol(ByVal sym As String) As Variant
    'Best-effort fallback only. Prefer broker-provided expiry date column whenever available.
    'Handles examples like NIFTY26MAY22950PE and NIFTY2660222550PE.
    Dim s As String, beforeStrike As String, strikeText As String, expiryPart As String
    Dim monthText As String, yy As Long, dd As Long, mm As Long

    On Error GoTo FailParse

    s = UCase$(Trim$(sym))
    strikeText = CStr(ExtractStrike(s))
    If Len(strikeText) = 0 Then GoTo FailParse

    s = Left$(s, Len(s) - 2) 'remove CE/PE
    beforeStrike = Left$(s, Len(s) - Len(strikeText))
    beforeStrike = Replace(beforeStrike, "NIFTY", "")
    beforeStrike = Replace(beforeStrike, "BANKNIFTY", "")
    beforeStrike = Replace(beforeStrike, "FINNIFTY", "")
    beforeStrike = Replace(beforeStrike, "MIDCPNIFTY", "")

    'Monthly format: 26MAY
    If Len(beforeStrike) >= 5 And Mid$(beforeStrike, 3, 3) Like "[A-Z][A-Z][A-Z]" Then
        yy = 2000 + CLng(Left$(beforeStrike, 2))
        monthText = Mid$(beforeStrike, 3, 3)
        mm = Month(DateValue("1-" & monthText & "-" & yy))
        'Monthly expiry fallback: last Tuesday of the month. Adjust manually if exchange calendar holiday applies.
        ParseExpiryDateFromSymbol = LastWeekdayOfMonth(yy, mm, vbTuesday)
        Exit Function
    End If

    'Weekly numeric format: YYMDD, e.g. 26602 = 2026-06-02
    If Len(beforeStrike) >= 5 And IsNumeric(Right$(beforeStrike, 5)) Then
        yy = 2000 + CLng(Left$(Right$(beforeStrike, 5), 2))
        mm = CLng(Mid$(Right$(beforeStrike, 5), 3, 1))
        dd = CLng(Right$(Right$(beforeStrike, 5), 2))
        ParseExpiryDateFromSymbol = DateSerial(yy, mm, dd)
        Exit Function
    End If

FailParse:
    ParseExpiryDateFromSymbol = Empty
End Function

Private Function LastWeekdayOfMonth(ByVal yy As Long, ByVal mm As Long, ByVal weekdayNum As VbDayOfWeek) As Date
    Dim d As Date
    d = DateSerial(yy, mm + 1, 0)
    Do While Weekday(d, vbSunday) <> weekdayNum
        d = d - 1
    Loop
    LastWeekdayOfMonth = d
End Function
